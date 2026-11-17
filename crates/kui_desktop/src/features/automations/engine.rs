//! Runs enabled automations: one worker thread per automation reads new messages from its
//! topic (the same reader as the live tail) and runs the action for each message that matches.
//!
//! Delivery is at most once. A worker starts at the end of the topic, so messages published
//! while the app is closed, or while a worker is reconnecting, are never delivered.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kui_kafka::KafkaClients;

use super::body;
use super::model::{Action, Automation, RunState, Status};
use super::template::Event;
use super::throttle::Throttle;
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

    /// Sends the action once with a made-up message, so the user can try a webhook before enabling it.
    pub fn test(&self, automation: &Automation) -> Result<u16> {
        let value = r#"{"test":true,"source":"KUI"}"#;
        let event = Event {
            topic: &automation.topic,
            partition: 0,
            offset: 0,
            timestamp: Some(chrono::Utc::now().timestamp_millis()),
            key: Some("test-key"),
            value: Some(value),
            headers: vec![("x-kui-test", Some("1"))],
            truncated: false,
        };
        self.shared.run_action(automation, &event).map_err(Error::msg)
    }
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

    fn run_action(&self, automation: &Automation, event: &Event<'_>) -> std::result::Result<u16, String> {
        match &automation.action {
            Action::Webhook(webhook) => {
                let body = body::render(&webhook.body, &automation.name, event)?;
                (self.sender)(webhook, body)
            }
        }
    }
}

fn work(shared: &Shared, automation: &Automation, run: &str, token: &CancelToken) {
    let request = TailRequest { topic: automation.topic.clone(), partition: None, query: automation.query.clone() };
    let mut throttle = Throttle::new(automation.max_per_minute);
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
                    handle(shared, automation, run, &mut throttle, message);
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

fn handle(shared: &Shared, automation: &Automation, run: &str, throttle: &mut Throttle, message: &Message) {
    if !throttle.allow(Instant::now()) {
        shared.update(&automation.id, run, |s| s.dropped += 1);
        return;
    }
    let outcome = shared.run_action(automation, &event_of(&automation.topic, message));
    shared.update(&automation.id, run, |s| {
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
            action: Action::Webhook(Webhook {
                url: "https://hooks.example.com/SECRET".into(),
                method: HttpMethod::Post,
                headers: vec![],
                body,
            }),
        }
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

        handle(&engine.shared, &a, "run", &mut throttle, &message(1, r#"{"id": 7}"#));

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
        handle(&engine.shared, &a, "run", &mut Throttle::new(60), &message(5, r#"{"id":7}"#));

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
        handle(&engine.shared, &a, "run", &mut Throttle::new(60), &message(1, "x"));

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
            handle(&engine.shared, &a, "run", &mut throttle, &message(offset, "x"));
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
                .test(&automation(Body::Template { text: "{{key}}:{{value.test}}:{{headers.x-kui-test}}".into() }, 60))
                .unwrap(),
            200
        );
        assert_eq!(sent.lock().unwrap().as_slice(), ["test-key:true:1"]);
    }

    #[test]
    fn retries_back_off_up_to_thirty_seconds() {
        let secs: Vec<u64> = (1..=7).map(|n| retry_delay(n).as_secs()).collect();
        assert_eq!(secs, [2, 4, 8, 16, 30, 30, 30]);
    }
}
