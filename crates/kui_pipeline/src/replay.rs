//! Runs a pipeline over messages that already exist, from the topic or from a message export,
//! instead of waiting for new ones. A dry run only shows what each route would send; otherwise the
//! requests go out, at most the pipeline's per-minute limit in one replay.

use chrono::{DateTime, SecondsFormat};
use serde::{Deserialize, Serialize};

use crate::body::Bodies;
use crate::model::{Pipeline, Route};
use crate::router::Router;
use crate::template::Event;

/// The most messages one replay reads.
pub const MAX_MESSAGES: usize = 1000;
/// Results listed one by one; the counters still cover every request.
pub const MAX_ITEMS: usize = 200;
/// A listed body is cut here so a replay of large messages stays small.
const MAX_SHOWN_BODY: usize = 8 * 1024;

/// One message, in the same shape KUI's message export writes (JSON or NDJSON), so an export
/// replays as it is.
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplayMessage {
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub partition: i32,
    #[serde(default)]
    pub offset: i64,
    /// ISO 8601.
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub key: Option<String>,
    /// `utf8`, or `hex` when the bytes weren't text.
    #[serde(default)]
    pub key_encoding: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub value_encoding: Option<String>,
    #[serde(default)]
    pub headers: Vec<ReplayHeader>,
    /// The key or value was cut to fit a size limit.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ReplayHeader {
    pub key: String,
    pub value: Option<String>,
}

pub fn iso_timestamp(millis: Option<i64>) -> Option<String> {
    millis.and_then(DateTime::from_timestamp_millis).map(|t| t.to_rfc3339_opts(SecondsFormat::Millis, true))
}

impl ReplayMessage {
    fn millis(&self) -> Option<i64> {
        self.timestamp.as_deref().and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|t| t.timestamp_millis())
    }

    /// The message as templates read it. `topic` is used when the message doesn't name one.
    pub fn event<'a>(&'a self, topic: &'a str) -> Event<'a> {
        Event {
            topic: self.topic.as_deref().unwrap_or(topic),
            partition: self.partition,
            offset: self.offset,
            timestamp: self.millis(),
            key: self.key.as_deref(),
            value: self.value.as_deref(),
            headers: self.headers.iter().map(|h| (h.key.as_str(), h.value.as_deref())).collect(),
            truncated: self.truncated,
        }
    }

    /// Roughly how much memory the message holds, to bound what a replay accepts.
    pub fn size(&self) -> usize {
        let text = |t: &Option<String>| t.as_ref().map_or(0, String::len);
        text(&self.key) + text(&self.value) + self.headers.iter().map(|h| h.key.len() + text(&h.value)).sum::<usize>()
    }

    #[cfg(test)]
    pub fn of_value(value: &str) -> Self {
        Self { value: Some(value.into()), ..Self::default() }
    }
}

fn payload<'a>(text: &'a Option<String>, encoding: &Option<String>) -> Option<kui_mql::Payload<'a>> {
    text.as_deref().map(|text| kui_mql::Payload { text, utf8: encoding.as_deref() != Some("hex") })
}

impl kui_mql::Record for ReplayMessage {
    fn partition(&self) -> i32 {
        self.partition
    }
    fn offset(&self) -> i64 {
        self.offset
    }
    fn timestamp(&self) -> Option<i64> {
        self.millis()
    }
    fn key(&self) -> Option<kui_mql::Payload<'_>> {
        payload(&self.key, &self.key_encoding)
    }
    fn value(&self) -> Option<kui_mql::Payload<'_>> {
        payload(&self.value, &self.value_encoding)
    }
    fn headers(&self) -> impl Iterator<Item = (&str, Option<&str>)> {
        self.headers.iter().map(|h| (h.key.as_str(), h.value.as_deref()))
    }
}

/// Messages read from an export file.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    /// The first `MAX_MESSAGES`.
    pub messages: Vec<ReplayMessage>,
    /// How many the file has.
    pub total: usize,
}

/// Reads a KUI message export: a JSON array, or one JSON object per line. CSV isn't read: its
/// headers column can't be told apart from the rest reliably.
pub fn parse_messages(text: &str) -> Result<Loaded, String> {
    let text = text.trim_start_matches('\u{feff}').trim();
    let all: Vec<ReplayMessage> = if text.starts_with('[') {
        serde_json::from_str(text).map_err(|e| format!("The file isn't a KUI message export (line {}).", e.line()))?
    } else {
        text.lines()
            .enumerate()
            .filter(|(_, line)| !line.trim().is_empty())
            .map(|(n, line)| {
                serde_json::from_str(line).map_err(|_| format!("Line {} isn't a message from a KUI export.", n + 1))
            })
            .collect::<Result<_, _>>()?
    };
    if all.is_empty() {
        return Err("The file has no messages.".to_string());
    }
    let total = all.len();
    Ok(Loaded { messages: all.into_iter().take(MAX_MESSAGES).collect(), total })
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Outcome {
    /// A dry run: shown, not sent.
    Planned,
    Sent {
        status: u16,
    },
    Failed {
        error: String,
    },
    /// Over the per-minute limit, or past the items one message may split into.
    Skipped,
}

/// One request the replay made, or would have made.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayItem {
    pub partition: i32,
    pub offset: i64,
    pub route: String,
    /// Empty when the body couldn't be built.
    pub body: String,
    /// `body` was cut for display.
    pub cut: bool,
    pub outcome: Outcome,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplayReport {
    /// Messages looked at.
    pub read: usize,
    /// Messages that passed the pipeline's filter and at least one route's.
    pub matched: usize,
    pub requests: usize,
    pub sent: usize,
    pub failed: usize,
    pub skipped: usize,
    /// The first `MAX_ITEMS` requests.
    pub items: Vec<ReplayItem>,
}

/// Sends one body for a route. `None` makes a dry run.
pub type Send<'s> = Option<&'s mut dyn FnMut(&Route, String) -> Result<u16, String>>;

/// Runs `messages` through the pipeline in order. When sending, at most `max_per_minute`
/// requests go out; the rest are skipped so a replay can never flood a target.
pub fn replay(pipeline: &Pipeline, router: &Router, messages: &[ReplayMessage], mut send: Send<'_>) -> ReplayReport {
    let mut report = ReplayReport::default();
    let budget = pipeline.max_per_minute as usize;
    for message in messages {
        report.read += 1;
        if !router.accepts(message) {
            continue;
        }
        let event = message.event(&pipeline.topic);
        let runs = router.route(pipeline, message, &event);
        if !runs.is_empty() {
            report.matched += 1;
        }
        for run in runs {
            let route = &pipeline.routes[run.route];
            let item = |report: &mut ReplayReport, body: &str, outcome: Outcome| {
                report.requests += 1;
                match &outcome {
                    Outcome::Sent { .. } => report.sent += 1,
                    Outcome::Failed { .. } => report.failed += 1,
                    Outcome::Skipped => report.skipped += 1,
                    Outcome::Planned => {}
                }
                if report.items.len() < MAX_ITEMS {
                    let (body, cut) = shown(body);
                    report.items.push(ReplayItem {
                        partition: message.partition,
                        offset: message.offset,
                        route: route.id.clone(),
                        body,
                        cut,
                        outcome,
                    });
                }
            };
            let Bodies { bodies, skipped } = match run.bodies {
                Ok(bodies) => bodies,
                Err(error) => {
                    item(&mut report, "", Outcome::Failed { error });
                    continue;
                }
            };
            for body in bodies {
                let outcome = match send.as_deref_mut() {
                    None => Outcome::Planned,
                    Some(_) if report.sent + report.failed >= budget => Outcome::Skipped,
                    Some(send) => match send(route, body.clone()) {
                        Ok(status) => Outcome::Sent { status },
                        Err(error) => Outcome::Failed { error },
                    },
                };
                item(&mut report, &body, outcome);
            }
            for _ in 0..skipped {
                item(&mut report, "", Outcome::Skipped);
            }
        }
    }
    report
}

fn shown(body: &str) -> (String, bool) {
    if body.len() <= MAX_SHOWN_BODY {
        return (body.to_string(), false);
    }
    let mut end = MAX_SHOWN_BODY;
    while !body.is_char_boundary(end) {
        end -= 1;
    }
    (body[..end].to_string(), true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Action, Body, HttpMethod, Webhook};

    fn route(id: &str, query: Option<&str>, text: &str) -> Route {
        Route {
            id: id.into(),
            query: query.map(Into::into),
            split: None,
            action: Action::Webhook(Webhook {
                url: "https://example.com".into(),
                method: HttpMethod::Post,
                headers: vec![],
                body: Body::Template { text: text.into() },
            }),
        }
    }

    fn pipeline(max_per_minute: u32, routes: Vec<Route>) -> Pipeline {
        Pipeline { name: "p".into(), topic: "orders".into(), query: None, max_per_minute, routes }
    }

    fn messages(values: &[&str]) -> Vec<ReplayMessage> {
        values
            .iter()
            .enumerate()
            .map(|(i, v)| ReplayMessage { offset: i as i64, ..ReplayMessage::of_value(v) })
            .collect()
    }

    #[test]
    fn a_dry_run_lists_every_request_without_sending() {
        let p = pipeline(60, vec![route("all", None, "{{value.id}}"), route("big", Some("value.id > 1"), "big")]);
        let report = replay(&p, &Router::new(&p).unwrap(), &messages(&[r#"{"id":1}"#, r#"{"id":2}"#]), None);

        assert_eq!((report.read, report.matched, report.requests, report.sent), (2, 2, 3, 0));
        let listed: Vec<_> = report.items.iter().map(|i| (i.offset, i.route.as_str(), i.body.as_str())).collect();
        assert_eq!(listed, [(0, "all", "1"), (1, "all", "2"), (1, "big", "big")]);
        assert!(report.items.iter().all(|i| i.outcome == Outcome::Planned));
    }

    #[test]
    fn sending_stops_at_the_rate_limit_and_records_failures() {
        let p = pipeline(2, vec![route("r", None, "{{value}}")]);
        let mut sent = Vec::new();
        let mut send = |_: &Route, body: String| {
            sent.push(body.clone());
            if body == "b" { Err("The server answered 500".to_string()) } else { Ok(204) }
        };
        let report = replay(&p, &Router::new(&p).unwrap(), &messages(&["a", "b", "c"]), Some(&mut send));

        assert_eq!(sent, ["a", "b"]);
        assert_eq!((report.sent, report.failed, report.skipped), (1, 1, 1));
        assert_eq!(report.items[1].outcome, Outcome::Failed { error: "The server answered 500".into() });
    }

    #[test]
    fn a_route_that_cannot_build_its_body_is_a_failed_item() {
        let mut r = route("r", None, "");
        r.split = Some("value.items".into());
        let Action::Webhook(w) = &mut r.action;
        w.body = Body::Template { text: "{{nope}}".into() };
        let p = pipeline(60, vec![r]);
        let report = replay(&p, &Router::new(&p).unwrap(), &messages(&[r#"{"items":[1]}"#]), None);
        assert!(matches!(report.items[0].outcome, Outcome::Failed { .. }));
    }

    #[test]
    fn reads_both_export_formats_and_uses_their_fields() {
        let json = r#"[{"topic":"orders","partition":2,"offset":9,"timestamp":"2026-01-01T00:00:00.000Z",
            "key":"k","keyEncoding":"utf8","value":"{\"id\":7}","valueEncoding":"utf8",
            "headers":[{"key":"x-source","value":"web"}]}]"#;
        let loaded = parse_messages(json).unwrap();
        let m = &loaded.messages[0];
        let event = m.event("fallback");
        assert_eq!(
            (event.topic, event.partition, event.offset, event.timestamp),
            ("orders", 2, 9, Some(1_767_225_600_000))
        );
        assert_eq!(event.headers, [("x-source", Some("web"))]);

        let ndjson = "{\"offset\":1,\"value\":\"a\"}\n\n{\"offset\":2,\"value\":\"b\"}\n";
        assert_eq!(parse_messages(ndjson).unwrap().total, 2);
        assert!(parse_messages("topic,partition\n").err().unwrap().contains("Line 1"));
        assert!(parse_messages("[]").is_err());
    }

    #[test]
    fn a_file_with_too_many_messages_is_cut_and_counted() {
        let lines = vec![r#"{"value":"x"}"#; MAX_MESSAGES + 3].join("\n");
        let loaded = parse_messages(&lines).unwrap();
        assert_eq!((loaded.messages.len(), loaded.total), (MAX_MESSAGES, MAX_MESSAGES + 3));
    }

    #[test]
    fn long_bodies_are_cut_on_a_character_boundary() {
        let (body, cut) = shown(&"é".repeat(MAX_SHOWN_BODY));
        assert!(cut && body.len() <= MAX_SHOWN_BODY);
    }
}
