//! Webhook body templates: `{{topic}}`, `{{value.order.id}}`, `{{headers.x-source | json}}`.
//! Inside a list mapped item by item, or when one request is sent per item, `{{item.sku}}`
//! reads the current item.
//!
//! A placeholder inserts text as it is. Add `| json` to insert it as a JSON value
//! (strings quoted and escaped, numbers bare, missing as `null`), which keeps a body that is
//! JSON valid whatever the message contains. Message data is untrusted, so it only ever
//! reaches the body, never the URL or the headers.

use std::cell::OnceCell;

use serde_json::{Map, Value, json};

/// One message as a template sees it.
pub struct Event<'a> {
    pub topic: &'a str,
    pub partition: i32,
    pub offset: i64,
    /// Epoch millis.
    pub timestamp: Option<i64>,
    pub key: Option<&'a str>,
    pub value: Option<&'a str>,
    pub headers: Vec<(&'a str, Option<&'a str>)>,
    /// The message was cut to fit a size limit, so `value` is a prefix.
    pub truncated: bool,
}

/// A key or value parsed as JSON. Filled on first use, so a message is parsed at most
/// once however many placeholders read it.
#[derive(Default)]
struct Parsed {
    key: OnceCell<Option<Value>>,
    value: OnceCell<Option<Value>>,
}

impl Parsed {
    fn get(&self, event: &Event<'_>, root: Root) -> Option<&Value> {
        let (text, cell) = match root {
            Root::Key => (event.key, &self.key),
            Root::Value => (event.value, &self.value),
        };
        cell.get_or_init(|| text.and_then(|t| serde_json::from_str(t).ok())).as_ref()
    }
}

impl Event<'_> {
    fn timestamp_text(&self) -> Option<String> {
        self.timestamp.and_then(chrono::DateTime::from_timestamp_millis).map(|t| t.to_rfc3339())
    }

    /// The JSON body sent when an automation has no template. `item` is the list item the
    /// request was split off for.
    pub fn envelope(&self, automation: &str, item: Option<&Value>) -> String {
        let parsed = Parsed::default();
        let headers: Map<String, Value> =
            self.headers.iter().map(|(k, v)| ((*k).to_string(), v.map_or(Value::Null, Value::from))).collect();
        let embed = |text: Option<&str>, parsed: Option<&Value>| match (text, parsed) {
            (_, Some(json)) => json.clone(),
            (Some(text), None) => Value::from(text),
            (None, None) => Value::Null,
        };
        let mut body = json!({
            "automation": automation,
            "topic": self.topic,
            "partition": self.partition,
            "offset": self.offset,
            "timestamp": self.timestamp_text(),
            "key": embed(self.key, parsed.get(self, Root::Key)),
            "value": embed(self.value, parsed.get(self, Root::Value)),
            "headers": headers,
            "truncated": self.truncated,
        });
        if let (Some(item), Value::Object(map)) = (item, &mut body) {
            map.insert("item".to_string(), item.clone());
        }
        body.to_string()
    }
}

/// What a template or field path may read.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Scope {
    Message,
    /// Also `item`: inside a list mapped item by item, or when a request is sent per item.
    Item,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Root {
    Key,
    Value,
}

#[derive(Debug, PartialEq)]
enum Field {
    Topic,
    Partition,
    Offset,
    Timestamp,
    Truncated,
    /// A key or value, optionally the JSON path inside it.
    Payload(Root, Vec<String>),
    Header(String),
    /// The current list item, optionally the JSON path inside it.
    Item(Vec<String>),
}

#[derive(Debug, PartialEq)]
enum Part<'t> {
    Text(&'t str),
    Placeholder { field: Field, json: bool },
}

fn parse(template: &str) -> Result<Vec<Part<'_>>, String> {
    let mut parts = Vec::new();
    let mut rest = template;
    while let Some(open) = rest.find("{{") {
        if open > 0 {
            parts.push(Part::Text(&rest[..open]));
        }
        let after = &rest[open + 2..];
        let close = after.find("}}").ok_or("A placeholder opened with {{ is never closed with }}.")?;
        parts.push(parse_placeholder(&after[..close])?);
        rest = &after[close + 2..];
    }
    if !rest.is_empty() {
        parts.push(Part::Text(rest));
    }
    Ok(parts)
}

fn parse_placeholder(inner: &str) -> Result<Part<'static>, String> {
    let (path, filter) = match inner.split_once('|') {
        Some((path, filter)) => (path.trim(), Some(filter.trim())),
        None => (inner.trim(), None),
    };
    let json = match filter {
        None => false,
        Some("json") => true,
        Some(other) => return Err(format!("Unknown filter \"{other}\" in {{{{{inner}}}}}. Only \"json\" exists.")),
    };
    let (root, sub) = match path.split_once('.') {
        Some((root, sub)) => (root, Some(sub)),
        None => (path, None),
    };
    let no_sub = |field: Field| match sub {
        None => Ok(field),
        Some(_) => Err(format!("{{{{{root}}}}} has no fields after the dot.")),
    };
    let field = match root {
        "topic" => no_sub(Field::Topic)?,
        "partition" => no_sub(Field::Partition)?,
        "offset" => no_sub(Field::Offset)?,
        "timestamp" => no_sub(Field::Timestamp)?,
        "truncated" => no_sub(Field::Truncated)?,
        "key" | "value" | "item" => {
            let steps = sub.map(|s| s.split('.').map(str::to_string).collect()).unwrap_or_default();
            match root {
                "key" => Field::Payload(Root::Key, steps),
                "value" => Field::Payload(Root::Value, steps),
                _ => Field::Item(steps),
            }
        }
        "headers" => match sub.filter(|s| !s.is_empty()) {
            Some(name) => Field::Header(name.to_string()),
            None => return Err("Write {{headers.NAME}} with the name of a header.".to_string()),
        },
        _ => {
            return Err(format!(
                "Unknown placeholder {{{{{path}}}}}. Use topic, partition, offset, timestamp, key, value, headers.NAME or truncated."
            ));
        }
    };
    Ok(Part::Placeholder { field, json })
}

/// Why `template` can't be used, so a typo is caught on save and not on the first message.
pub fn validate(template: &str, scope: Scope) -> Result<(), String> {
    for part in parse(template)? {
        if let Part::Placeholder { field, .. } = part {
            in_scope(&field, scope)?;
        }
    }
    Ok(())
}

/// Why `path` (such as `value.order.id`) can't be read from a message.
pub fn validate_path(path: &str, scope: Scope) -> Result<(), String> {
    in_scope(&parse_field(path)?, scope)
}

fn in_scope(field: &Field, scope: Scope) -> Result<(), String> {
    match (field, scope) {
        (Field::Item(_), Scope::Message) => {
            Err("\"item\" only works inside a list mapped item by item, or when sending one request per item."
                .to_string())
        }
        _ => Ok(()),
    }
}

fn parse_field(path: &str) -> Result<Field, String> {
    if path.contains('|') {
        return Err(format!("\"{}\" isn't a field. Filters only work in templates.", path.trim()));
    }
    match parse_placeholder(path)? {
        Part::Placeholder { field, .. } => Ok(field),
        Part::Text(_) => Err("Not a field.".to_string()),
    }
}

/// Reads fields of one message. A key or value is parsed as JSON at most once, however many
/// fields read it.
pub struct Lookup<'e, 'a> {
    event: &'e Event<'a>,
    parsed: Parsed,
}

impl<'e, 'a> Lookup<'e, 'a> {
    pub fn new(event: &'e Event<'a>) -> Self {
        Self { event, parsed: Parsed::default() }
    }

    pub fn render(&self, template: &str, item: Option<&Value>) -> Result<String, String> {
        let mut out = String::with_capacity(template.len());
        for part in parse(template)? {
            match part {
                Part::Text(text) => out.push_str(text),
                Part::Placeholder { field, json } => {
                    let value = resolve(&field, self.event, &self.parsed, item);
                    if json {
                        out.push_str(&value.unwrap_or(Value::Null).to_string());
                    } else {
                        match value {
                            Some(Value::String(text)) => out.push_str(&text),
                            Some(Value::Null) | None => {}
                            Some(other) => out.push_str(&other.to_string()),
                        }
                    }
                }
            }
        }
        Ok(out)
    }

    /// The field as a JSON value, or `None` when the message doesn't have it. Unlike a template
    /// placeholder, a whole `key` or `value` that is JSON comes back as that JSON, not as text.
    pub fn field(&self, path: &str, item: Option<&Value>) -> Result<Option<Value>, String> {
        let field = parse_field(path)?;
        if let Field::Payload(root, steps) = &field
            && steps.is_empty()
            && let Some(json) = self.parsed.get(self.event, *root)
        {
            return Ok(Some(json.clone()));
        }
        Ok(resolve(&field, self.event, &self.parsed, item))
    }
}

fn resolve(field: &Field, event: &Event<'_>, parsed: &Parsed, item: Option<&Value>) -> Option<Value> {
    match field {
        Field::Topic => Some(event.topic.into()),
        Field::Partition => Some(event.partition.into()),
        Field::Offset => Some(event.offset.into()),
        Field::Timestamp => event.timestamp_text().map(Value::from),
        Field::Truncated => Some(event.truncated.into()),
        Field::Header(name) => event.headers.iter().find(|(k, _)| k == name).and_then(|(_, v)| v.map(Value::from)),
        Field::Payload(root, steps) => {
            let text = match root {
                Root::Key => event.key,
                Root::Value => event.value,
            };
            if steps.is_empty() {
                return text.map(Value::from);
            }
            walk(parsed.get(event, *root)?, steps)
        }
        Field::Item(steps) => walk(item?, steps),
    }
}

fn walk(root: &Value, steps: &[String]) -> Option<Value> {
    steps
        .iter()
        .try_fold(root, |node, step| match node {
            Value::Object(map) => map.get(step),
            Value::Array(items) => step.parse::<usize>().ok().and_then(|i| items.get(i)),
            _ => None,
        })
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(template: &str, event: &Event<'_>, item: Option<&Value>) -> Result<String, String> {
        Lookup::new(event).render(template, item)
    }

    fn event<'a>(value: Option<&'a str>) -> Event<'a> {
        Event {
            topic: "orders",
            partition: 2,
            offset: 41,
            timestamp: Some(1_700_000_000_000),
            key: Some("order-1"),
            value,
            headers: vec![("x-source", Some("web")), ("x-empty", None)],
            truncated: false,
        }
    }

    #[test]
    fn fills_message_fields_and_json_paths() {
        let e = event(Some(r#"{"id":7,"customer":{"name":"Ada \"A\""},"items":[{"sku":"a"},{"sku":"b"}]}"#));
        let out = render(
            "{{topic}}/{{partition}}@{{offset}} {{key}} {{value.id}} {{value.customer.name}} {{value.items.1.sku}} {{headers.x-source}}",
            &e,
            None,
        )
        .unwrap();
        assert_eq!(out, r#"orders/2@41 order-1 7 Ada "A" b web"#);
    }

    #[test]
    fn json_filter_escapes_so_untrusted_text_cannot_break_the_body() {
        let e = event(Some(r#"he said "hi"\n"#));
        let body = render(r#"{"text": {{value | json}}, "missing": {{headers.nope | json}}}"#, &e, None).unwrap();
        let parsed: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed["text"], r#"he said "hi"\n"#);
        assert_eq!(parsed["missing"], Value::Null);
    }

    #[test]
    fn missing_values_render_empty() {
        let e = event(None);
        assert_eq!(render("[{{value}}][{{value.a}}][{{headers.x-empty}}]", &e, None).unwrap(), "[][][]");
    }

    #[test]
    fn rejects_what_would_fail_on_the_first_message() {
        for bad in ["{{nope}}", "{{topic.x}}", "{{headers}}", "{{value | upper}}", "oops {{value"] {
            assert!(validate(bad, Scope::Message).is_err(), "{bad}");
        }
        assert!(validate("plain text, no placeholders", Scope::Message).is_ok());
        assert!(validate("{{ value.a.b | json }}", Scope::Message).is_ok());
    }

    #[test]
    fn field_returns_structured_values_and_none_when_missing() {
        let e = event(Some(r#"{"id":7,"tags":["a"]}"#));
        let lookup = Lookup::new(&e);
        assert_eq!(lookup.field("value", None).unwrap(), Some(json!({"id": 7, "tags": ["a"]})));
        assert_eq!(lookup.field("value.tags.0", None).unwrap(), Some(json!("a")));
        assert_eq!(lookup.field("value.nope", None).unwrap(), None);
        assert_eq!(lookup.field("key", None).unwrap(), Some(json!("order-1")));
        assert_eq!(lookup.field("partition", None).unwrap(), Some(json!(2)));
        assert!(lookup.field("value | json", None).is_err() && lookup.field("nope", None).is_err());
        assert!(
            validate_path("headers.x-source", Scope::Message).is_ok()
                && validate_path("headers", Scope::Message).is_err()
        );
    }

    #[test]
    fn default_body_embeds_json_values_and_marks_text() {
        let e = event(Some(r#"{"id":7}"#));
        let body: Value = serde_json::from_str(&e.envelope("alert", None)).unwrap();
        assert_eq!(body["automation"], "alert");
        assert_eq!(body["value"]["id"], 7);
        assert_eq!(body["key"], "order-1");
        assert_eq!(body["headers"]["x-source"], "web");
        assert_eq!(body["headers"]["x-empty"], Value::Null);
        assert_eq!(body["timestamp"], "2023-11-14T22:13:20+00:00");

        let text: Value = serde_json::from_str(&event(Some("plain")).envelope("a", None)).unwrap();
        assert_eq!(text["value"], "plain");
    }

    #[test]
    fn item_reads_the_current_list_item_and_only_where_there_is_one() {
        let e = event(Some(r#"{"id":7}"#));
        let item = json!({"sku": "a", "tags": ["x"]});
        assert_eq!(render("{{value.id}}:{{item.sku}}:{{item.tags.0}}", &e, Some(&item)).unwrap(), "7:a:x");
        assert_eq!(Lookup::new(&e).field("item", Some(&item)).unwrap(), Some(item.clone()));
        assert_eq!(render("[{{item.sku}}]", &e, None).unwrap(), "[]");

        assert!(validate("{{item.sku}}", Scope::Message).unwrap_err().contains("only works inside a list"));
        assert!(validate_path("item", Scope::Message).is_err());
        assert!(validate("{{item.sku}}", Scope::Item).is_ok() && validate_path("item.sku", Scope::Item).is_ok());

        let body: Value = serde_json::from_str(&e.envelope("a", Some(&item))).unwrap();
        assert_eq!(body["item"]["sku"], "a");
    }
}
