//! Builds a new JSON object from a message, field by field: the transform step of
//! extract, transform, load. Pure, so every rule is unit-tested without Kafka.

use serde_json::{Map, Number, Value};

use super::model::{FieldMapping, Source, Transform};
use super::template::{self, Lookup};

const MAX_FIELDS: usize = 100;
const MAX_DEPTH: usize = 10;
/// A target like `items.999999999` must not make the sender allocate a huge array.
const MAX_INDEX: usize = 999;
const MAX_TARGET: usize = 200;

enum Segment {
    Key(String),
    Index(usize),
}

fn segments(target: &str) -> Result<Vec<Segment>, String> {
    let target = target.trim();
    if target.is_empty() || target.len() > MAX_TARGET {
        return Err("Every field needs a target name.".to_string());
    }
    let parts: Vec<Segment> = target
        .split('.')
        .map(|part| match part.parse::<usize>() {
            Ok(index) => Ok(Segment::Index(index)),
            Err(_) if part.is_empty() => Err(format!("The target \"{target}\" has an empty part.")),
            Err(_) => Ok(Segment::Key(part.to_string())),
        })
        .collect::<Result<_, _>>()?;
    if parts.len() > MAX_DEPTH {
        return Err(format!("The target \"{target}\" is nested more than {MAX_DEPTH} levels deep."));
    }
    if parts.iter().any(|p| matches!(p, Segment::Index(i) if *i > MAX_INDEX)) {
        return Err(format!("The target \"{target}\" uses an array position above {MAX_INDEX}."));
    }
    Ok(parts)
}

/// Stores `value` at `path`, creating objects and arrays on the way. Fails when the path runs
/// through a value of the wrong kind, or when `overwrite` is off and something is already there.
fn set(node: &mut Value, path: &[Segment], value: Value, overwrite: bool) -> Result<(), ()> {
    let Some((first, rest)) = path.split_first() else {
        if !overwrite && !node.is_null() {
            return Err(());
        }
        *node = value;
        return Ok(());
    };
    match first {
        Segment::Key(key) => {
            if node.is_null() {
                *node = Value::Object(Map::new());
            }
            let Value::Object(map) = node else { return Err(()) };
            set(map.entry(key.clone()).or_insert(Value::Null), rest, value, overwrite)
        }
        Segment::Index(index) => {
            if node.is_null() {
                *node = Value::Array(Vec::new());
            }
            let Value::Array(items) = node else { return Err(()) };
            if items.len() <= *index {
                items.resize(*index + 1, Value::Null);
            }
            set(&mut items[*index], rest, value, overwrite)
        }
    }
}

/// Why `fields` can't be used, so a mistake is caught on save and not on the first message.
pub fn validate(fields: &[FieldMapping]) -> Result<(), String> {
    if fields.is_empty() {
        return Err("Add at least one field to map.".to_string());
    }
    if fields.len() > MAX_FIELDS {
        return Err(format!("A mapping can have up to {MAX_FIELDS} fields."));
    }
    let mut shape = Value::Null;
    for field in fields {
        let path = segments(&field.target)?;
        let target = field.target.trim();
        match &field.source {
            Source::Field { path } => {
                template::validate_path(path).map_err(|e| format!("\"{target}\": {e}"))?;
            }
            Source::Template { text } => {
                template::validate(text).map_err(|e| format!("\"{target}\": {e}"))?;
            }
            Source::Fixed { .. } => {}
        }
        // A marker stands in for the value: a second write to the same place, or a child under
        // a field that already holds a value, is what `overwrite: false` rejects.
        set(&mut shape, &path, Value::Bool(true), false)
            .map_err(|()| format!("\"{target}\" collides with another field or mixes object and array parts."))?;
    }
    Ok(())
}

/// Builds the object for one message. Assumes `validate` accepted `fields`.
pub fn apply(fields: &[FieldMapping], lookup: &Lookup<'_, '_>) -> Result<Value, String> {
    let mut out = Value::Null;
    for field in fields {
        let target = field.target.trim();
        let found = match &field.source {
            Source::Field { path } => lookup.field(path)?,
            Source::Fixed { value } => Some(value.clone()),
            Source::Template { text } => Some(Value::String(lookup.render(text)?)),
        };
        let value = match found.filter(|v| !v.is_null()).or_else(|| field.default.clone()) {
            Some(value) => match field.transform {
                Some(transform) => convert(transform, value).map_err(|e| format!("\"{target}\": {e}"))?,
                None => value,
            },
            None => Value::Null,
        };
        set(&mut out, &segments(target)?, value, true).map_err(|()| format!("\"{target}\" can't be placed."))?;
    }
    Ok(out)
}

/// Never repeats the value in an error: it comes from a message and may be sensitive.
fn convert(transform: Transform, value: Value) -> Result<Value, String> {
    let text_only = |value: Value, change: fn(&str) -> String| match value {
        Value::String(text) => Value::String(change(&text)),
        other => other,
    };
    match transform {
        Transform::Trim => Ok(text_only(value, |t| t.trim().to_string())),
        Transform::Upper => Ok(text_only(value, str::to_uppercase)),
        Transform::Lower => Ok(text_only(value, str::to_lowercase)),
        Transform::ToString => Ok(match value {
            Value::String(_) => value,
            other => Value::String(other.to_string()),
        }),
        Transform::ToNumber => match value {
            Value::Number(_) => Ok(value),
            Value::String(text) => parse_number(text.trim()).map(Value::Number).ok_or_else(not_a_number),
            _ => Err(not_a_number()),
        },
        Transform::ToBoolean => match &value {
            Value::Bool(_) => Ok(value),
            Value::String(text) => match text.trim().to_lowercase().as_str() {
                "true" | "yes" | "1" => Ok(Value::Bool(true)),
                "false" | "no" | "0" => Ok(Value::Bool(false)),
                _ => Err(not_a_boolean()),
            },
            Value::Number(n) if n.as_i64() == Some(1) => Ok(Value::Bool(true)),
            Value::Number(n) if n.as_i64() == Some(0) => Ok(Value::Bool(false)),
            _ => Err(not_a_boolean()),
        },
        Transform::EpochToIso => {
            let millis = match &value {
                Value::Number(n) => n.as_i64(),
                Value::String(text) => text.trim().parse().ok(),
                _ => None,
            };
            millis
                .and_then(chrono::DateTime::from_timestamp_millis)
                .map(|t| Value::String(t.to_rfc3339()))
                .ok_or_else(|| "isn't a time in epoch milliseconds".to_string())
        }
    }
}

fn parse_number(text: &str) -> Option<Number> {
    text.parse::<i64>()
        .map(Number::from)
        .ok()
        .or_else(|| text.parse::<u64>().map(Number::from).ok())
        .or_else(|| text.parse::<f64>().ok().and_then(Number::from_f64))
}

fn not_a_number() -> String {
    "isn't a number".to_string()
}

fn not_a_boolean() -> String {
    "isn't true or false".to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::features::automations::template::Event;

    fn field(target: &str, source: Source) -> FieldMapping {
        FieldMapping { target: target.into(), source, transform: None, default: None }
    }

    fn path(p: &str) -> Source {
        Source::Field { path: p.into() }
    }

    fn run(fields: &[FieldMapping], value: &str) -> Result<Value, String> {
        let event = Event {
            topic: "orders",
            partition: 1,
            offset: 9,
            timestamp: Some(1_700_000_000_000),
            key: Some("k-1"),
            value: Some(value),
            headers: vec![("x-source", Some("web"))],
            truncated: false,
        };
        validate(fields)?;
        apply(fields, &Lookup::new(&event))
    }

    #[test]
    fn reshapes_a_message_into_a_nested_object() {
        let fields = [
            field("order.id", path("value.id")),
            field("customer.name", path("value.customer.name")),
            field("items.0.sku", path("value.items.0.sku")),
            field("meta.topic", path("topic")),
            field("meta.source", Source::Fixed { value: json!("kafka") }),
            field("summary", Source::Template { text: "{{key}} from {{headers.x-source}}".into() }),
            field("raw", path("value.customer")),
        ];
        let out = run(&fields, r#"{"id":7,"customer":{"name":"Ada"},"items":[{"sku":"a"}]}"#).unwrap();
        assert_eq!(
            out,
            json!({
                "order": {"id": 7},
                "customer": {"name": "Ada"},
                "items": [{"sku": "a"}],
                "meta": {"topic": "orders", "source": "kafka"},
                "summary": "k-1 from web",
                "raw": {"name": "Ada"},
            })
        );
    }

    #[test]
    fn missing_values_use_the_default_or_become_null() {
        let mut with_default = field("status", path("value.status"));
        with_default.default = Some(json!("unknown"));
        let out = run(&[with_default, field("note", path("value.note"))], r#"{"note":null}"#).unwrap();
        assert_eq!(out, json!({"status": "unknown", "note": null}));
    }

    #[test]
    fn transforms_convert_types_and_dates() {
        let with = |target: &str, p: &str, t| FieldMapping { transform: Some(t), ..field(target, path(p)) };
        let fields = [
            with("amount", "value.amount", Transform::ToNumber),
            with("paid", "value.paid", Transform::ToBoolean),
            with("name", "value.name", Transform::Upper),
            with("email", "value.email", Transform::Lower),
            with("at", "timestamp", Transform::ToString),
            with("when", "value.ms", Transform::EpochToIso),
            with("id", "value.id", Transform::ToString),
            with("clean", "value.clean", Transform::Trim),
        ];
        let out = run(
            &fields,
            r#"{"amount":"12.50","paid":"yes","name":"ada","email":"A@X.IO","ms":1700000000000,"id":42,"clean":"  hi "}"#,
        )
        .unwrap();
        assert_eq!(out["amount"], json!(12.5));
        assert_eq!(out["paid"], json!(true));
        assert_eq!((out["name"].as_str(), out["email"].as_str()), (Some("ADA"), Some("a@x.io")));
        assert_eq!(out["when"], json!("2023-11-14T22:13:20+00:00"));
        assert_eq!((out["id"].as_str(), out["clean"].as_str()), (Some("42"), Some("hi")));
    }

    #[test]
    fn a_failed_conversion_names_the_field_but_not_the_value() {
        let fields = [FieldMapping { transform: Some(Transform::ToNumber), ..field("amount", path("value.amount")) }];
        let err = run(&fields, r#"{"amount":"SECRET-abc"}"#).unwrap_err();
        assert_eq!(err, "\"amount\": isn't a number");
    }

    #[test]
    fn rejects_mappings_that_cannot_work() {
        let bad = |fields: &[FieldMapping]| validate(fields).unwrap_err();
        assert!(bad(&[]).contains("at least one"));
        assert!(bad(&[field("", path("key"))]).contains("target"));
        assert!(bad(&[field("a..b", path("key"))]).contains("empty part"));
        assert!(bad(&[field("a", path("nope"))]).contains("Unknown placeholder"));
        assert!(bad(&[field("a", Source::Template { text: "{{".into() })]).contains("never closed"));
        assert!(bad(&[field("a", path("key")), field("a", path("topic"))]).contains("collides"));
        assert!(bad(&[field("a", path("key")), field("a.b", path("topic"))]).contains("collides"));
        assert!(bad(&[field("a.b", path("key")), field("a", path("topic"))]).contains("collides"));
        assert!(bad(&[field("a.0", path("key")), field("a.b", path("topic"))]).contains("collides"));
        assert!(bad(&[field("items.5000", path("key"))]).contains("array position"));
        assert!(bad(&[field("a.b.c.d.e.f.g.h.i.j.k", path("key"))]).contains("levels"));
    }

    #[test]
    fn array_gaps_are_filled_with_null() {
        let out = run(&[field("items.2", path("key"))], "{}").unwrap();
        assert_eq!(out, json!({"items": [null, null, "k-1"]}));
    }
}
