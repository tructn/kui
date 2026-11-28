use std::collections::HashMap;

use serde_json::{Map, Value};
use yaml_rust2::parser::{Event, MarkedEventReceiver, Parser, Tag};
use yaml_rust2::scanner::{Marker, TScalarStyle};

use super::template::scalar;

/// Reads the first YAML document into JSON. Short-form CloudFormation tags
/// become their long form, `!Sub x` -> `{"Fn::Sub": "x"}`, and are never evaluated.
pub(super) fn to_json(text: &str) -> std::result::Result<Value, String> {
    let mut builder = JsonBuilder::default();
    Parser::new_from_str(text)
        .load(&mut builder, false)
        .map_err(|e| format!("not valid YAML: {} (line {})", e.info(), e.marker().line()))?;
    Ok(builder.root.unwrap_or(Value::Null))
}

#[derive(Default)]
struct JsonBuilder {
    stack: Vec<Frame>,
    root: Option<Value>,
    anchors: HashMap<usize, Value>,
}

struct Frame {
    container: Container,
    anchor: usize,
    tag: Option<Tag>,
}

enum Container {
    Seq(Vec<Value>),
    Map(Map<String, Value>, Option<String>),
}

impl MarkedEventReceiver for JsonBuilder {
    fn on_event(&mut self, event: Event, _mark: Marker) {
        match event {
            Event::Scalar(text, style, anchor, tag) => {
                let value = tagged(tag, scalar_value(text, style));
                self.push(value, anchor);
            }
            Event::SequenceStart(anchor, tag) => {
                self.stack.push(Frame { container: Container::Seq(Vec::new()), anchor, tag });
            }
            Event::MappingStart(anchor, tag) => {
                self.stack.push(Frame { container: Container::Map(Map::new(), None), anchor, tag });
            }
            Event::SequenceEnd | Event::MappingEnd => {
                if let Some(frame) = self.stack.pop() {
                    let value = match frame.container {
                        Container::Seq(items) => Value::Array(items),
                        Container::Map(map, _) => Value::Object(map),
                    };
                    self.push(tagged(frame.tag, value), frame.anchor);
                }
            }
            Event::Alias(anchor) => {
                let value = self.anchors.get(&anchor).cloned().unwrap_or(Value::Null);
                self.push(value, 0);
            }
            Event::Nothing | Event::StreamStart | Event::StreamEnd | Event::DocumentStart | Event::DocumentEnd => {}
        }
    }
}

impl JsonBuilder {
    fn push(&mut self, value: Value, anchor: usize) {
        if anchor > 0 {
            self.anchors.insert(anchor, value.clone());
        }
        match self.stack.last_mut().map(|f| &mut f.container) {
            None => {
                self.root.get_or_insert(value);
            }
            Some(Container::Seq(items)) => items.push(value),
            Some(Container::Map(map, pending)) => match pending.take() {
                None => *pending = Some(scalar(&value).unwrap_or_else(|| value.to_string())),
                Some(key) => {
                    map.insert(key, value);
                }
            },
        }
    }
}

fn scalar_value(text: String, style: TScalarStyle) -> Value {
    if style != TScalarStyle::Plain {
        return Value::String(text);
    }
    match text.as_str() {
        "" | "~" | "null" | "Null" | "NULL" => Value::Null,
        "true" | "True" | "TRUE" => Value::Bool(true),
        "false" | "False" | "FALSE" => Value::Bool(false),
        _ => text
            .parse::<i64>()
            .map(Value::from)
            .or_else(|_| text.parse::<f64>().map(Value::from))
            .unwrap_or(Value::String(text)),
    }
}

fn tagged(tag: Option<Tag>, value: Value) -> Value {
    match tag {
        Some(tag) if tag.handle == "!" => {
            let key = match tag.suffix.as_str() {
                "Ref" | "Condition" => tag.suffix,
                other => format!("Fn::{other}"),
            };
            Value::Object(Map::from_iter([(key, value)]))
        }
        _ => value,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_form_tags_become_long_form() {
        let value = to_json("a: !Ref Foo\nb: !GetAtt Foo.Arn\nc: !Join [',', [x, y]]").unwrap();
        assert_eq!(value["a"], serde_json::json!({ "Ref": "Foo" }));
        assert_eq!(value["b"], serde_json::json!({ "Fn::GetAtt": "Foo.Arn" }));
        assert_eq!(value["c"], serde_json::json!({ "Fn::Join": [",", ["x", "y"]] }));
    }
}
