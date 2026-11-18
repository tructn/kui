//! Runs enabled automations: one worker thread per automation reads new messages from its
//! topic (the same reader as the live tail) and runs the action for each message that matches.
//!
//! Delivery is at most once. A worker starts at the end of the topic, so messages published
//! while the app is closed, or while a worker is reconnecting, are never delivered.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kui_kafka::KafkaClients;

use kui_pipeline::body::{self, Bodies};
use kui_pipeline::template::Event;
use kui_pipeline::throttle::Throttle;

use kui_mql::Query;

use super::model::{Action, Automation, Route, RunState, Status};
use super::webhook::{Sender, http_sender};
use crate::error::{Error, Result};
use crate::features::messages::model::{Message, TailRequest};
use crate::features::messages::service::tail;
use crate::lock::lock;
use crate::tasks::{CancelToken, Tasks};

/// Connects to a cluster by id, reusing the app's cached clients.
pub type Connect = Arc<dyn Fn(&str) -> Result<Arc<KafkaClients>> + Send + Sync>;

#[derive(Clone)]
pub struct Engine {
    shared: Arc<Shared>,
}

struct Shared {
    connect: Connect,
    sender: Arc<Sender>,
    tasks: Arc<Tasks>,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// Automation id -> the run that owns it. A worker that was stopped keeps running for a
    /// moment; comparing run ids stops it from overwriting the status of its replacement.
    runs: HashMap<String, String>,
    statuses: HashMap<String, Status>,
}

impl Engine {
    /// An engine that sends webhooks over HTTP.
    pub fn http(connect: Connect) -> Result<Self> {
        Ok(Self::new(connect, http_sender()?))
    }

    fn new(connect: Connect, sender: Arc<Sender>) -> Self {
        Self { shared: Arc::new(Shared { connect, sender, tasks: Arc::default(), inner: Mutex::default() }) }
    }

    /// Starts the automation, replacing a worker already running for it.
    pub fn start(&self, automation: &Automation) {
        self.stop(&automation.id);
        let run = uuid::Uuid::new_v4().to_string();
        let token = self.shared.tasks.start(&run);
        {
            let mut inner = lock(&self.shared.inner);
            inner.runs.insert(automation.id.clone(), run.clone());
            inner
                .statuses
                .insert(automation.id.clone(), Status { state: RunState::Running, ..Status::stopped(&automation.id) });
        }
        let (shared, owned, worker_run) = (self.shared.clone(), automation.clone(), run.clone());
        let spawned = std::thread::Builder::new()
            .name("kui-automation".to_string())
            .spawn(move || work(&shared, &owned, &worker_run, &token));
        if spawned.is_err() {
            self.shared.update(&automation.id, &run, |s| {
                s.state = RunState::Stopped;
                s.last_error = Some("Could not start a worker thread.".to_string());
            });
        }
    }

    pub fn stop(&self, id: &str) {
        let mut inner = lock(&self.shared.inner);
        if let Some(run) = inner.runs.remove(id) {
            self.shared.tasks.cancel(&run);
        }
        if let Some(status) = inner.statuses.get_mut(id) {
            status.state = RunState::Stopped;
        }
    }

    /// Forgets a deleted automation's status along with its worker.
    pub fn remove(&self, id: &str) {
        self.stop(id);
        lock(&self.shared.inner).statuses.remove(id);
    }

    pub fn statuses(&self) -> Vec<Status> {
        lock(&self.shared.inner).statuses.values().cloned().collect()
    }

    /// How many automations are running, which decides whether closing the window keeps the app alive.
    pub fn running(&self) -> usize {
        lock(&self.shared.inner).runs.len()
    }

    /// Sends route `route`'s action once for `event`, or for a made-up message, so the user can
    /// try a webhook before enabling it. The route's filter is skipped, and when the message splits
    /// into items, only the first is sent.
    pub fn test(&self, automation: &Automation, route: usize, event: Option<&Event<'_>>) -> Result<u16> {
        let route = automation.routes.get(route).ok_or_else(|| Error::msg("Unknown route."))?;
        let made_up = Event {
            topic: &automation.topic,
            partition: 0,
            offset: 0,
            timestamp: Some(chrono::Utc::now().timestamp_millis()),
            key: Some("test-key"),
            value: Some(r#"{"test":true,"source":"KUI"}"#),
            headers: vec![("x-kui-test", Some("1"))],
            truncated: false,
        };
        let Bodies { bodies, .. } = bodies(automation, route, event.unwrap_or(&made_up)).map_err(Error::msg)?;
        let first = bodies.into_iter().next().ok_or_else(|| {
            Error::msg(format!(
                "The test message has no items in \"{}\", so nothing would be sent.",
                route.split.as_deref().unwrap_or_default()
            ))
        })?;
        self.shared.send(route, first).map_err(Error::msg)
    }
}

fn bodies(automation: &Automation, route: &Route, event: &Event<'_>) -> std::result::Result<Bodies, String> {
    match &route.action {
        Action::Webhook(webhook) => body::render_all(&webhook.body, &automation.name, route.split.as_deref(), event),
    }
}

/// Each route's own filter, parsed once per worker. `validate` already accepted them.
fn route_filters(automation: &Automation) -> std::result::Result<Vec<Option<Query>>, String> {
    automation
        .routes
        .iter()
        .map(|r| match r.query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
            Some(q) => Query::parse(q).map(Some).map_err(|e| format!("Invalid route filter: {e}")),
            None => Ok(None),
        })
        .collect()
}

impl Shared {
    /// Applies `change` to the status unless `run` has been replaced or stopped.
    fn update(&self, id: &str, run: &str, change: impl FnOnce(&mut Status)) {
        let mut inner = lock(&self.inner);
        if inner.runs.get(id).is_some_and(|current| current == run)
            && let Some(status) = inner.statuses.get_mut(id)
        {
            change(status);
        }
    }

    fn send(&self, route: &Route, body: String) -> std::result::Result<u16, String> {
        match &route.action {
            Action::Webhook(webhook) => (self.sender)(webhook, body),
        }
    }

    fn record(&self, automation: &Automation, run: &str, outcome: std::result::Result<u16, String>) {
        self.update(&automation.id, run, |s| {
            s.last_fired_at = Some(chrono::Utc::now().timestamp_millis());
            match outcome {
                Ok(_) => {
                    s.fired += 1;
                    s.last_error = None;
                }
                Err(why) => {
                    s.failed += 1;
                    s.last_error = Some(why);
                }
            }
        });
    }
}

fn work(shared: &Shared, automation: &Automation, run: &str, token: &CancelToken) {
    let request = TailRequest { topic: automation.topic.clone(), partition: None, query: automation.query.clone() };
    let mut throttle = Throttle::new(automation.max_per_minute);
    let filters = match route_filters(automation) {
        Ok(filters) => filters,
        Err(why) => {
            return shared.update(&automation.id, run, |s| {
                s.state = RunState::Stopped;
                s.last_error = Some(why);
            });
        }
    };
    let mut failures = 0u32;
    while !token.is_cancelled() {
        let read = (shared.connect)(&automation.cluster_id).and_then(|clients| {
            shared.update(&automation.id, run, |s| {
                s.state = RunState::Running;
                s.last_error = None;
            });
            tail(&clients, &request, token, |batch| {
                failures = 0;
                for message in &batch {
                    if token.is_cancelled() {
                        return false;
                    }
                    handle(shared, automation, &filters, run, &mut throttle, message);
                }
                !token.is_cancelled()
            })
        });
        if let Err(e) = read {
            failures += 1;
            shared.update(&automation.id, run, |s| {
                s.state = RunState::Retrying;
                s.last_error = Some(format!("Can't read \"{}\": {e}", automation.topic));
            });
        }
        // After an error, and also if the reader returned without being asked to stop.
        sleep_unless_cancelled(token, retry_delay(failures.max(1)));
    }
}

/// Each request, not each message, counts against the rate limit.
fn handle(
    shared: &Shared,
    automation: &Automation,
    filters: &[Option<Query>],
    run: &str,
    throttle: &mut Throttle,
    message: &Message,
) {
    let event = event_of(&automation.topic, message);
    let mut dropped = 0;
    for (index, (route, filter)) in automation.routes.iter().zip(filters).enumerate() {
        if filter.as_ref().is_some_and(|q| !q.matches(message)) {
            continue;
        }
        // Only name the route when there is more than one to tell apart.
        let label = |why: String| match automation.routes.len() {
            1 => why,
            _ => format!("Route {}: {why}", index + 1),
        };
        let Bodies { bodies, skipped } = match bodies(automation, route, &event) {
            Ok(rendered) => rendered,
            Err(why) => {
                shared.record(automation, run, Err(label(why)));
                continue;
            }
        };
        dropped += skipped;
        for body in bodies {
            if throttle.allow(Instant::now()) {
                shared.record(automation, run, shared.send(route, body).map_err(label));
            } else {
                dropped += 1;
            }
        }
    }
    if dropped > 0 {
        shared.update(&automation.id, run, |s| s.dropped += dropped as u64);
    }
}

fn event_of<'a>(topic: &'a str, message: &'a Message) -> Event<'a> {
    let text = |p: &'a Option<crate::features::messages::model::Payload>| p.as_ref().map(|p| p.text.as_str());
    Event {
        topic,
        partition: message.partition,
        offset: message.offset,
        timestamp: message.timestamp,
        key: text(&message.key),
        value: text(&message.value),
        headers: message.headers.iter().map(|h| (h.key.as_str(), h.value.as_deref())).collect(),
        truncated: message.key.iter().chain(message.value.iter()).any(|p| p.truncated),
    }
}

/// 2, 4, 8, 16, then 30 seconds.
fn retry_delay(failures: u32) -> Duration {
    Duration::from_secs((1u64 << failures.min(5)).min(30))
}

fn sleep_unless_cancelled(token: &CancelToken, total: Duration) {
    let deadline = Instant::now() + total;
    while !token.is_cancelled() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::automations::model::{Body, HttpMethod, Webhook};

    fn route(id: &str, body: Body) -> Route {
        Route {
            id: id.into(),
            query: None,
            split: None,
            action: Action::Webhook(Webhook {
                url: "https://hooks.example.com/SECRET".into(),
                method: HttpMethod::Post,
                headers: vec![],
                body,
            }),
        }
    }
    use crate::features::messages::model::{MessageHeader, Payload};

    type Sent = Arc<Mutex<Vec<String>>>;

    fn automation(body: Body, max_per_minute: u32) -> Automation {
        Automation {
            id: "a".into(),
            name: "Alert".into(),
            enabled: true,
            cluster_id: "c".into(),
            topic: "orders".into(),
            query: None,
            max_per_minute,
            routes: vec![route("r1", body)],
        }
    }

    fn handle(engine: &Engine, a: &Automation, throttle: &mut Throttle, message: &Message) {
        super::handle(&engine.shared, a, &route_filters(a).unwrap(), "run", throttle, message);
    }

    fn message(offset: i64, value: &str) -> Message {
        let payload = |text: &str| Payload { text: text.into(), encoding: "utf8", size: text.len(), truncated: false };
        Message {
            partition: 0,
            offset,
            timestamp: Some(1_700_000_000_000),
            key: Some(payload("k")),
            value: Some(payload(value)),
            headers: vec![MessageHeader { key: "x-source".into(), value: Some("web".into()) }],
        }
    }

    /// An engine whose webhook sender records bodies and answers `answer`, and whose cluster is unreachable.
    fn engine(answer: std::result::Result<u16, String>) -> (Engine, Sent) {
        let sent = Sent::default();
        let log = sent.clone();
        let sender: Arc<Sender> = Arc::new(move |_: &Webhook, body: String| {
            log.lock().unwrap().push(body);
            answer.clone()
        });
        let connect: Connect = Arc::new(|_| Err(Error::msg("no broker")));
        (Engine::new(connect, sender), sent)
    }

    /// Registers `a` as running so `handle` may update its status, without starting a worker.
    fn register(engine: &Engine, a: &Automation) {
        let mut inner = lock(&engine.shared.inner);
        inner.runs.insert(a.id.clone(), "run".into());
        inner.statuses.insert(a.id.clone(), Status { state: RunState::Running, ..Status::stopped(&a.id) });
    }

    fn status(engine: &Engine) -> Status {
        engine.statuses().into_iter().next().unwrap()
    }

    #[test]
    fn a_message_is_rendered_into_the_body_and_counted() {
        let (engine, sent) = engine(Ok(200));
        let a = automation(
            Body::Template { text: r#"{"id": {{value.id | json}}, "from": "{{headers.x-source}}"}"#.into() },
            60,
        );
        register(&engine, &a);
        let mut throttle = Throttle::new(a.max_per_minute);

        handle(&engine, &a, &mut throttle, &message(1, r#"{"id": 7}"#));

        assert_eq!(sent.lock().unwrap().as_slice(), [r#"{"id": 7, "from": "web"}"#]);
        let s = status(&engine);
        assert_eq!((s.fired, s.failed, s.dropped), (1, 0, 0));
        assert!(s.last_fired_at.is_some() && s.last_error.is_none());
    }

    #[test]
    fn without_a_template_the_body_describes_the_message() {
        let (engine, sent) = engine(Ok(204));
        let a = automation(Body::Envelope, 60);
        register(&engine, &a);
        handle(&engine, &a, &mut Throttle::new(60), &message(5, r#"{"id":7}"#));

        let body: serde_json::Value = serde_json::from_str(&sent.lock().unwrap()[0]).unwrap();
        assert_eq!(
            (body["topic"].as_str(), body["offset"].as_i64(), body["value"]["id"].as_i64()),
            (Some("orders"), Some(5), Some(7))
        );
    }

    #[test]
    fn a_failing_webhook_is_counted_and_never_names_the_url() {
        let (engine, _) = engine(Err("The server answered 404 Not Found".into()));
        let a = automation(Body::Envelope, 60);
        register(&engine, &a);
        handle(&engine, &a, &mut Throttle::new(60), &message(1, "x"));

        let s = status(&engine);
        assert_eq!((s.fired, s.failed), (0, 1));
        assert_eq!(s.last_error.as_deref(), Some("The server answered 404 Not Found"));
    }

    #[test]
    fn messages_over_the_rate_limit_are_dropped_not_sent() {
        let (engine, sent) = engine(Ok(200));
        let a = automation(Body::Envelope, 2);
        register(&engine, &a);
        let mut throttle = Throttle::new(2);
        for offset in 0..5 {
            handle(&engine, &a, &mut throttle, &message(offset, "x"));
        }

        assert_eq!(sent.lock().unwrap().len(), 2);
        let s = status(&engine);
        assert_eq!((s.fired, s.dropped), (2, 3));
    }

    #[test]
    fn a_replaced_worker_cannot_overwrite_its_successor() {
        let (engine, _) = engine(Ok(200));
        let a = automation(Body::Envelope, 60);
        register(&engine, &a);
        engine.shared.update("a", "an-older-run", |s| s.fired = 99);
        assert_eq!(status(&engine).fired, 0);
    }

    #[test]
    fn an_unreachable_cluster_retries_with_a_readable_error_and_stops_on_request() {
        let (engine, sent) = engine(Ok(200));
        let a = automation(Body::Envelope, 60);
        engine.start(&a);
        assert_eq!(engine.running(), 1);

        let deadline = Instant::now() + Duration::from_secs(5);
        while status(&engine).state != RunState::Retrying && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let s = status(&engine);
        assert_eq!(s.state, RunState::Retrying);
        assert_eq!(s.last_error.as_deref(), Some("Can't read \"orders\": no broker"));

        engine.stop("a");
        assert_eq!((engine.running(), status(&engine).state), (0, RunState::Stopped));
        assert!(sent.lock().unwrap().is_empty());
    }

    #[test]
    fn test_sends_a_sample_message_through_the_same_path() {
        let (engine, sent) = engine(Ok(200));
        assert_eq!(
            engine
                .test(
                    &automation(Body::Template { text: "{{key}}:{{value.test}}:{{headers.x-kui-test}}".into() }, 60),
                    0,
                    None
                )
                .unwrap(),
            200
        );
        assert_eq!(sent.lock().unwrap().as_slice(), ["test-key:true:1"]);
    }

    #[test]
    fn a_split_message_sends_one_request_per_item_within_the_rate_limit() {
        let (engine, sent) = engine(Ok(200));
        let mut a = automation(Body::Template { text: "{{item.sku}}".into() }, 2);
        a.routes[0].split = Some("value.items".into());
        register(&engine, &a);
        let mut throttle = Throttle::new(2);
        handle(&engine, &a, &mut throttle, &message(1, r#"{"items":[{"sku":"a"},{"sku":"b"},{"sku":"c"}]}"#));

        assert_eq!(sent.lock().unwrap().as_slice(), ["a", "b"]);
        let s = status(&engine);
        assert_eq!((s.fired, s.dropped), (2, 1));
    }

    #[test]
    fn test_with_a_split_sends_only_the_first_item_and_explains_an_empty_list() {
        let (engine, sent) = engine(Ok(200));
        let mut a = automation(Body::Template { text: "{{item}}".into() }, 60);
        a.routes[0].split = Some("value.items".into());
        let mut sample = message(0, "");
        let event = Event { value: Some(r#"{"items":[1,2]}"#), ..event_of("orders", &sample) };
        engine.test(&a, 0, Some(&event)).unwrap();
        assert_eq!(sent.lock().unwrap().as_slice(), ["1"]);

        sample.value = None;
        let err = engine.test(&a, 0, Some(&event_of("orders", &sample))).unwrap_err().to_string();
        assert!(err.contains("no items in \"value.items\""), "{err}");
    }

    #[test]
    fn every_matching_route_sends_and_a_failure_names_its_route() {
        let (engine, sent) = engine(Ok(200));
        let mut a = automation(Body::Template { text: "all:{{value.id}}".into() }, 60);
        let mut failed = route("r2", Body::Template { text: "failed:{{value.id}}".into() });
        failed.query = Some("value.status = 'failed'".into());
        a.routes.push(failed);
        register(&engine, &a);
        let mut throttle = Throttle::new(60);
        handle(&engine, &a, &mut throttle, &message(1, r#"{"id":1,"status":"paid"}"#));
        handle(&engine, &a, &mut throttle, &message(2, r#"{"id":2,"status":"failed"}"#));
        assert_eq!(sent.lock().unwrap().as_slice(), ["all:1", "all:2", "failed:2"]);

        let (failing, _) = super::tests::engine(Err("The server answered 500".into()));
        register(&failing, &a);
        handle(&failing, &a, &mut throttle, &message(3, r#"{"id":3,"status":"failed"}"#));
        assert_eq!(status(&failing).last_error.as_deref(), Some("Route 2: The server answered 500"));
    }

    #[test]
    fn retries_back_off_up_to_thirty_seconds() {
        let secs: Vec<u64> = (1..=7).map(|n| retry_delay(n).as_secs()).collect();
        assert_eq!(secs, [2, 4, 8, 16, 30, 30, 30]);
    }
}
