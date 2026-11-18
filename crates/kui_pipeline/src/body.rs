//! Turns a message into the request bodies, however the automation was set up to do it.

use serde_json::Value;

use crate::mapping;
use crate::model::{Body, BodyPreview};
use crate::template::{self, Event, Lookup, Scope};

/// The largest body template or mapping, as JSON, an automation may have.
pub const MAX_BODY: usize = 64 * 1024;

/// One message must not fan out into a flood of requests.
pub const MAX_SPLIT: usize = 100;

/// Why `body` can't be used. `scope` is `Item` when a request is sent per list item.
pub fn validate(body: &Body, scope: Scope) -> Result<(), String> {
    match body {
        Body::Envelope => Ok(()),
        Body::Template { text } => {
            if text.len() > MAX_BODY {
                return Err("The body template is too long.".to_string());
            }
            template::validate(text, scope).map_err(|e| format!("Body template: {e}"))
        }
        Body::Mapping { fields } => {
            let size = serde_json::to_string(fields).map_or(usize::MAX, |s| s.len());
            if size > MAX_BODY {
                return Err("The field mapping is too large.".to_string());
            }
            mapping::validate(fields, scope).map_err(|e| format!("Field mapping: {e}"))
        }
    }
}

/// The scope a body is checked in, given the automation's split path.
pub fn scope_of(split: Option<&str>) -> Scope {
    if split.is_some() { Scope::Item } else { Scope::Message }
}

/// The bodies for one message: a single one, or one per item of the list at `split`.
pub struct Bodies {
    pub bodies: Vec<String>,
    /// Items past `MAX_SPLIT`, which are not sent.
    pub skipped: usize,
}

pub fn render_all(body: &Body, automation: &str, split: Option<&str>, event: &Event<'_>) -> Result<Bodies, String> {
    let lookup = Lookup::new(event);
    let Some(split) = split else {
        return Ok(Bodies { bodies: vec![render(body, automation, event, &lookup, None)?], skipped: 0 });
    };
    let items = match lookup.field(split, None)? {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => items,
        Some(single) => vec![single],
    };
    let bodies = items
        .iter()
        .take(MAX_SPLIT)
        .map(|item| render(body, automation, event, &lookup, Some(item)))
        .collect::<Result<_, _>>()?;
    Ok(Bodies { bodies, skipped: items.len().saturating_sub(MAX_SPLIT) })
}

fn render(
    body: &Body,
    automation: &str,
    event: &Event<'_>,
    lookup: &Lookup<'_, '_>,
    item: Option<&Value>,
) -> Result<String, String> {
    match body {
        Body::Envelope => Ok(event.envelope(automation, item)),
        Body::Template { text } => lookup.render(text, item),
        Body::Mapping { fields } => mapping::apply(fields, lookup, item).map(|value| value.to_string()),
    }
}

pub fn preview(body: &Body, automation: &str, split: Option<&str>, event: &Event<'_>) -> Result<BodyPreview, String> {
    validate(body, scope_of(split))?;
    let Bodies { bodies, skipped } = render_all(body, automation, split, event)?;
    let requests = bodies.len() + skipped;
    let first = bodies.into_iter().next().map(|text| match serde_json::from_str::<Value>(&text) {
        Ok(json) => serde_json::to_string_pretty(&json).unwrap_or(text),
        Err(_) => text,
    });
    Ok(BodyPreview { first, requests })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(value: &str) -> Event<'_> {
        Event {
            topic: "orders",
            partition: 0,
            offset: 1,
            timestamp: None,
            key: None,
            value: Some(value),
            headers: vec![],
            truncated: false,
        }
    }

    fn template(text: &str) -> Body {
        Body::Template { text: text.into() }
    }

    #[test]
    fn without_a_split_a_message_makes_one_body() {
        let out = render_all(&template("{{value.id}}"), "a", None, &event(r#"{"id":7}"#)).unwrap();
        assert_eq!((out.bodies, out.skipped), (vec!["7".to_string()], 0));
    }

    #[test]
    fn a_split_makes_one_body_per_item_and_none_without_a_list() {
        let body = template("{{value.id}}-{{item.sku}}");
        let out = render_all(&body, "a", Some("value.items"), &event(r#"{"id":7,"items":[{"sku":"a"},{"sku":"b"}]}"#));
        assert_eq!(out.unwrap().bodies, ["7-a", "7-b"]);
        assert!(render_all(&body, "a", Some("value.items"), &event("{}")).unwrap().bodies.is_empty());

        let envelope: Value = serde_json::from_str(
            &render_all(&Body::Envelope, "a", Some("value.items"), &event(r#"{"items":[3]}"#)).unwrap().bodies[0],
        )
        .unwrap();
        assert_eq!(envelope["item"], 3);
    }

    #[test]
    fn a_split_stops_at_the_limit_and_counts_the_rest() {
        let items = format!("[{}]", vec!["1"; MAX_SPLIT + 5].join(","));
        let out = render_all(&template("{{item}}"), "a", Some("value"), &event(&items)).unwrap();
        assert_eq!((out.bodies.len(), out.skipped), (MAX_SPLIT, 5));
        assert_eq!(preview(&template("{{item}}"), "a", Some("value"), &event(&items)).unwrap().requests, MAX_SPLIT + 5);
    }

    #[test]
    fn item_needs_a_split() {
        assert!(validate(&template("{{item}}"), scope_of(None)).is_err());
        assert!(validate(&template("{{item}}"), scope_of(Some("value.items"))).is_ok());
    }
}
