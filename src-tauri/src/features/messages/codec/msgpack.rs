//! MessagePack, a binary JSON that carries its own structure.

use rmpv::Value as Mp;
use serde_json::{Map, Value};

/// Decodes bytes that are exactly one MessagePack map or array, as compact JSON.
/// Scalars are rejected: almost any short binary is a valid MessagePack number.
pub fn decode(bytes: &[u8]) -> Option<String> {
    let mut rest = bytes;
    let value = rmpv::decode::read_value(&mut rest).ok()?;
    if !rest.is_empty() || !matches!(value, Mp::Map(_) | Mp::Array(_)) {
        return None;
    }
    Some(to_json(value).to_string())
}

fn to_json(value: Mp) -> Value {
    match value {
        Mp::Nil => Value::Null,
        Mp::Boolean(b) => Value::Bool(b),
        Mp::Integer(i) => i.as_i64().map(Value::from).or_else(|| i.as_u64().map(Value::from)).unwrap_or(Value::Null),
        Mp::F32(f) => Value::from(f64::from(f)),
        Mp::F64(f) => Value::from(f),
        Mp::String(s) => match s.into_str() {
            Some(s) => Value::String(s),
            None => Value::Null,
        },
        Mp::Binary(b) | Mp::Ext(_, b) => Value::String(super::hex(&b)),
        Mp::Array(items) => Value::Array(items.into_iter().map(to_json).collect()),
        Mp::Map(entries) => {
            let map: Map<String, Value> = entries
                .into_iter()
                .map(|(k, v)| {
                    // JSON keys are strings; other key types keep their JSON spelling.
                    let key = match k {
                        Mp::String(s) => s.into_str().unwrap_or_default(),
                        other => to_json(other).to_string(),
                    };
                    (key, to_json(v))
                })
                .collect();
            Value::Object(map)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_maps_and_arrays() {
        // {"a": 1, "b": [true, nil]}
        let bytes = [0x82, 0xa1, b'a', 0x01, 0xa1, b'b', 0x92, 0xc3, 0xc0];
        assert_eq!(decode(&bytes).unwrap(), r#"{"a":1,"b":[true,null]}"#);
    }

    #[test]
    fn rejects_scalars_and_trailing_bytes() {
        assert_eq!(decode(&[0x05]), None);
        assert_eq!(decode(&[0x90, 0x00]), None);
    }
}
