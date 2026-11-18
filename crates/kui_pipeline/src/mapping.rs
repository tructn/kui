//! Builds a new JSON object from a message, field by field: the transform step of
//! extract, transform, load. Pure, so every rule is unit-tested without Kafka.

use serde_json::{Map, Number, Value};

use crate::model::{FieldMapping, Source, Transform};
use crate::template::{self, Lookup, Scope};

/// Counted across every level, lists included.
const MAX_FIELDS: usize = 100;
const MAX_LIST_DEPTH: usize = 4;
/// A message with a huge list must not build a huge body.
const MAX_ITEMS: usize = 1000;
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
pub fn validate(fields: &[FieldMapping], scope: Scope) -> Result<(), String> {
    validate_level(fields, scope, 0, &mut 0)
}

fn validate_level(fields: &[FieldMapping], scope: Scope, depth: usize, count: &mut usize) -> Result<(), String> {
    if fields.is_empty() {
        return Err(if depth == 0 {
            "Add at least one field to map."
        } else {
            "Add at least one field for each item."
        }
        .to_string());
    }
    *count += fields.len();
    if *count > MAX_FIELDS {
        return Err(format!("A mapping can have up to {MAX_FIELDS} fields."));
    }
    let mut shape = Value::Null;
    for field in fields {
        let path = segments(&field.target)?;
        let target = field.target.trim();
        let context = |e: String| format!("\"{target}\": {e}");
        match &field.source {
            Source::Field { path } => template::validate_path(path, scope).map_err(context)?,
            Source::Template { text } => template::validate(text, scope).map_err(context)?,
            Source::Fixed { .. } => {}
            Source::Each { path, fields } => {
                template::validate_path(path, scope).map_err(context)?;
                if depth >= MAX_LIST_DEPTH {
                    return Err(context(format!("lists can be nested up to {MAX_LIST_DEPTH} levels deep.")));
                }
                validate_level(fields, Scope::Item, depth + 1, count).map_err(context)?;
            }
        }
        // A marker stands in for the value: a second write to the same place, or a child under
        // a field that already holds a value, is what `overwrite: false` rejects.
        set(&mut shape, &path, Value::Bool(true), false)
            .map_err(|()| format!("\"{target}\" collides with another field or mixes object and array parts."))?;
    }
    Ok(())
}

/// Builds the object for one message, or for one list `item`. Assumes `validate` accepted `fields`.
pub fn apply(fields: &[FieldMapping], lookup: &Lookup<'_, '_>, item: Option<&Value>) -> Result<Value, String> {
    let mut out = Value::Null;
    for field in fields {
        let target = field.target.trim();
        let found = match &field.source {
            Source::Field { path } => lookup.field(path, item)?,
            Source::Fixed { value } => Some(value.clone()),
            Source::Template { text } => Some(Value::String(lookup.render(text, item)?)),
            Source::Each { path, fields } => match lookup.field(path, item)? {
                None | Some(Value::Null) => None,
                Some(list) => Some(each(fields, lookup, list).map_err(|e| format!("\"{target}\": {e}"))?),
            },
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

/// A value that isn't a list is treated as a list of one, as a single item often is in practice.
fn as_list(value: Value) -> Vec<Value> {
    match value {
        Value::Array(items) => items,
        single => vec![single],
    }
}

fn each(fields: &[FieldMapping], lookup: &Lookup<'_, '_>, list: Value) -> Result<Value, String> {
    let items = as_list(list);
    if items.len() > MAX_ITEMS {
        return Err(format!("the list has more than {MAX_ITEMS} items."));
    }
    items.iter().map(|item| apply(fields, lookup, Some(item))).collect::<Result<_, _>>().map(Value::Array)
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
        Transform::Count => Ok(Value::from(as_list(value).len())),
        Transform::Join => Ok(Value::String(
            as_list(value)
                .into_iter()
                .filter(|item| !item.is_null())
                .map(|item| match item {
                    Value::String(text) => text,
                    other => other.to_string(),
                })
                .collect::<Vec<_>>()
                .join(", "),
        )),
        Transform::First => Ok(as_list(value).into_iter().next().unwrap_or(Value::Null)),
        Transform::Last => Ok(as_list(value).pop().unwrap_or(Value::Null)),
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
    use crate::template::Event;

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
        validate(fields, Scope::Message)?;
        apply(fields, &Lookup::new(&event), None)
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
        let bad = |fields: &[FieldMapping]| validate(fields, Scope::Message).unwrap_err();
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

    fn each(target: &str, p: &str, fields: Vec<FieldMapping>) -> FieldMapping {
        field(target, Source::Each { path: p.into(), fields })
    }

    #[test]
    fn each_rebuilds_every_item_and_can_read_the_parent() {
        let fields = [
            field("order", path("value.id")),
            each(
                "lines",
                "value.items",
                vec![
                    field("sku", path("item.sku")),
                    field("order", path("value.id")),
                    field("label", Source::Template { text: "{{item.sku}} x{{item.qty}}".into() }),
                    each("tags", "item.tags", vec![field("name", path("item"))]),
                ],
            ),
            FieldMapping { transform: Some(Transform::Count), ..field("count", path("value.items")) },
        ];
        let out = run(&fields, r#"{"id":7,"items":[{"sku":"a","qty":2,"tags":["x","y"]},{"sku":"b","qty":1}]}"#);
        assert_eq!(
            out.unwrap(),
            json!({
                "order": 7,
                "lines": [
                    {"sku": "a", "order": 7, "label": "a x2", "tags": [{"name": "x"}, {"name": "y"}]},
                    {"sku": "b", "order": 7, "label": "b x1", "tags": null},
                ],
                "count": 2,
            })
        );
    }

    #[test]
    fn each_treats_a_single_value_as_a_list_of_one_and_a_missing_one_as_null() {
        let fields = [each("lines", "value.items", vec![field("sku", path("item.sku"))])];
        assert_eq!(run(&fields, r#"{"items":{"sku":"a"}}"#).unwrap(), json!({"lines": [{"sku": "a"}]}));
        assert_eq!(run(&fields, "{}").unwrap(), json!({"lines": null}));
    }

    #[test]
    fn each_refuses_a_list_too_long_to_send() {
        let items = format!("[{}]", vec!["1"; MAX_ITEMS + 1].join(","));
        let err = run(&[each("lines", "value", vec![field("n", path("item"))])], &items).unwrap_err();
        assert!(err.contains("more than"), "{err}");
    }

    #[test]
    fn list_transforms_count_join_and_pick() {
        let with = |target: &str, t| FieldMapping { transform: Some(t), ..field(target, path("value.tags")) };
        let fields = [
            with("count", Transform::Count),
            with("all", Transform::Join),
            with("first", Transform::First),
            with("last", Transform::Last),
        ];
        let out = run(&fields, r#"{"tags":["a",2,null,"c"]}"#).unwrap();
        assert_eq!(out, json!({"count": 4, "all": "a, 2, c", "first": "a", "last": "c"}));
    }

    #[test]
    fn item_is_only_readable_inside_a_list() {
        let bad = |fields: &[FieldMapping]| validate(fields, Scope::Message).unwrap_err();
        assert!(bad(&[field("a", path("item.sku"))]).contains("only works inside a list"));
        assert!(bad(&[each("a", "item", vec![field("b", path("key"))])]).contains("only works inside a list"));
        assert!(bad(&[each("a", "value.items", vec![])]).contains("each item"));
        assert!(validate(&[field("a", path("item.sku"))], Scope::Item).is_ok());

        let nested =
            (0..=MAX_LIST_DEPTH).fold(field("x", path("item")), |inner, _| each("l", "value.items", vec![inner]));
        assert!(bad(&[nested]).contains("nested up to"));
    }

    #[test]
    fn array_gaps_are_filled_with_null() {
        let out = run(&[field("items.2", path("key"))], "{}").unwrap();
        assert_eq!(out, json!({"items": [null, null, "k-1"]}));
    }
}
