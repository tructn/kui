//! Turns message bytes into something readable.
//!
//! Kafka stores bytes and never says what's in them, so the format is detected:
//! 1. Schema Registry framing (magic byte 0, then a 4-byte schema id): decoded
//!    as Avro, Protobuf or JSON Schema using the registered schema.
//! 2. Printable UTF-8: JSON, XML or plain text.
//! 3. Other binary: MessagePack, else Protobuf without a schema, else hex.

mod avro;
mod msgpack;
mod protobuf;

use std::collections::HashMap;

use super::model::{Format, Payload};
use crate::kafka::schema_registry::{Schema, SchemaSource, SchemaType};

/// Decodes a batch of messages. Parsed schemas are kept for the decoder's
/// lifetime (one page, or one live-tail batch), failures included, so a broken
/// or unreachable registry is asked once per schema rather than once per message.
pub struct Decoder<'a> {
    registry: Option<&'a dyn SchemaSource>,
    schemas: HashMap<u32, Result<Parsed, String>>,
}

enum Parsed {
    Avro(avro::AvroSchema),
    Protobuf(protobuf::ProtoSchema),
    Json,
}

impl<'a> Decoder<'a> {
    pub fn new(registry: Option<&'a dyn SchemaSource>) -> Self {
        Self { registry, schemas: HashMap::new() }
    }

    pub fn decode(&mut self, bytes: &[u8]) -> Payload {
        let mut payload = raw(bytes);
        if let Some((id, body)) = registry_framing(bytes) {
            payload.schema_id = Some(id);
            self.decode_framed(&mut payload, id, body);
        } else if payload.encoding == "utf8" {
            payload.format = text_format(&payload.text);
        } else if let Some(json) = msgpack::decode(bytes) {
            payload.format = Format::Msgpack;
            payload.decoded = Some(json);
        } else if let Some(json) = protobuf::decode_raw(bytes) {
            payload.format = Format::Protobuf;
            payload.decoded = Some(json);
            payload.note = Some("Decoded without a schema, so fields show as numbers. It may not be Protobuf.".into());
        }
        payload
    }

    fn decode_framed(&mut self, payload: &mut Payload, id: u32, body: &[u8]) {
        let Some(registry) = self.registry else {
            // JSON Schema payloads are plain JSON after the header, so they read fine without a registry.
            if let Some(text) = std::str::from_utf8(body).ok().filter(|t| text_format(t) == Format::Json) {
                payload.format = Format::JsonSchema;
                payload.decoded = Some(text.to_string());
            } else {
                payload.note = Some(format!(
                    "Written with Schema Registry schema {id}. Add the registry URL to this cluster's settings to decode it."
                ));
            }
            return;
        };

        let parsed = self.schemas.entry(id).or_insert_with(|| parse_schema(registry, id));
        let result = match parsed {
            Err(e) => {
                payload.note = Some(format!("Couldn't load schema {id}: {e}"));
                return;
            }
            Ok(Parsed::Avro(schema)) => {
                payload.format = Format::Avro;
                avro::decode(schema, body)
            }
            Ok(Parsed::Protobuf(schema)) => {
                payload.format = Format::Protobuf;
                protobuf::decode(schema, body)
            }
            Ok(Parsed::Json) => {
                payload.format = Format::JsonSchema;
                std::str::from_utf8(body).map(str::to_string).map_err(|_| "JSON Schema payload isn't UTF-8".into())
            }
        };
        match result {
            Ok(json) => payload.decoded = Some(json),
            Err(e) => payload.note = Some(e),
        }
    }
}

fn parse_schema(registry: &dyn SchemaSource, id: u32) -> Result<Parsed, String> {
    let registered = registry.by_id(id).map_err(|e| e.to_string())?;
    match registered.schema_type {
        SchemaType::Avro => avro::parse(registry, &registered).map(Parsed::Avro),
        SchemaType::Protobuf => protobuf::parse(registry, &registered).map(Parsed::Protobuf),
        SchemaType::Json => Ok(Parsed::Json),
    }
}

/// Encodes JSON with a registered schema and frames it the way registry-aware
/// serializers do: magic byte 0, the schema id, then the body. For Protobuf,
/// `message` picks the message type (default: the first in the file).
pub fn encode(
    registry: &dyn SchemaSource,
    schema: &Schema,
    message: Option<&str>,
    json: &str,
) -> Result<Vec<u8>, String> {
    let id = schema.id.ok_or("The registry didn't say which id this schema has")?;
    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("Value isn't valid JSON: {e}"))?;
    let body = match schema.schema_type {
        SchemaType::Avro => avro::encode(&avro::parse(registry, schema)?, value)?,
        SchemaType::Protobuf => protobuf::encode(&protobuf::parse(registry, schema)?, message, json)?,
        SchemaType::Json => value.to_string().into_bytes(),
    };
    Ok([&[0][..], &id.to_be_bytes(), &body].concat())
}

/// The message types a Protobuf schema offers; empty for other schema types.
pub fn message_names(registry: &dyn SchemaSource, schema: &Schema) -> Result<Vec<String>, String> {
    match schema.schema_type {
        SchemaType::Protobuf => Ok(protobuf::message_names(&protobuf::parse(registry, schema)?)),
        _ => Ok(Vec::new()),
    }
}

/// The schema id and body of a Schema Registry–framed payload.
fn registry_framing(bytes: &[u8]) -> Option<(u32, &[u8])> {
    match bytes {
        [0, a, b, c, d, body @ ..] => Some((u32::from_be_bytes([*a, *b, *c, *d]), body)),
        _ => None,
    }
}

/// The bytes themselves: text if printable UTF-8, otherwise hex.
fn raw(bytes: &[u8]) -> Payload {
    let (text, encoding) = match std::str::from_utf8(bytes) {
        Ok(text) if is_printable(text) => (text.to_string(), "utf8"),
        _ => (hex(bytes), "hex"),
    };
    Payload { text, encoding, size: bytes.len(), format: Format::Binary, decoded: None, schema_id: None, note: None }
}

/// Raw message bytes as display text, for header values.
pub fn display(bytes: &[u8]) -> String {
    raw(bytes).text
}

/// UTF-8 can still hold control bytes (a registry header starts with 0x00);
/// text with any besides tab and line breaks is shown as binary.
fn is_printable(text: &str) -> bool {
    !text.chars().any(|c| c.is_control() && !matches!(c, '\t' | '\n' | '\r'))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" ")
}

fn text_format(text: &str) -> Format {
    let trimmed = text.trim();
    if (trimmed.starts_with('{') || trimmed.starts_with('['))
        && serde_json::from_str::<serde::de::IgnoredAny>(trimmed).is_ok()
    {
        Format::Json
    } else if trimmed.starts_with('<') && trimmed.ends_with('>') {
        Format::Xml
    } else {
        Format::Text
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::error::{Error, Result};
    use crate::kafka::schema_registry::Schema;

    fn decode(bytes: &[u8]) -> Payload {
        Decoder::new(None).decode(bytes)
    }

    #[test]
    fn utf8_is_kept_as_text() {
        assert_eq!(decode(b"{\"a\":1}").text, "{\"a\":1}");
        assert_eq!(decode("héllo".as_bytes()).encoding, "utf8");
    }

    #[test]
    fn binary_becomes_hex() {
        let p = decode(&[0xff, 0x10]);
        assert_eq!(p.encoding, "hex");
        assert_eq!(p.text, "ff 10");
        assert_eq!(p.size, 2);
        assert_eq!(p.format, Format::Binary);
    }

    #[test]
    fn control_bytes_are_binary_even_if_valid_utf8() {
        assert_eq!(decode(&[b'a', 0x00, 0x01]).encoding, "hex");
        assert_eq!(decode(b"line\n\tindented\r\n").encoding, "utf8");
    }

    #[test]
    fn detects_text_formats() {
        assert_eq!(decode(b" {\"a\": [1, 2]} ").format, Format::Json);
        assert_eq!(decode(b"[1,2]").format, Format::Json);
        assert_eq!(decode(b"<?xml version=\"1.0\"?><a><b/></a>").format, Format::Xml);
        assert_eq!(decode(b"{not json").format, Format::Text);
        assert_eq!(decode(b"42").format, Format::Text);
    }

    #[test]
    fn detects_msgpack_and_raw_protobuf() {
        let p = decode(&[0x81, 0xa1, b'a', 0x01]);
        assert_eq!((p.format, p.decoded.as_deref()), (Format::Msgpack, Some(r#"{"a":1}"#)));
        let p = decode(&[0x08, 0x96, 0x01]);
        assert_eq!((p.format, p.decoded.as_deref()), (Format::Protobuf, Some(r#"{"1":150}"#)));
        assert!(p.note.is_some(), "a schemaless guess says so");
    }

    #[test]
    fn framed_json_schema_reads_without_a_registry() {
        let p = decode(b"\x00\x00\x00\x00\x2a{\"a\":1}");
        assert_eq!(p.schema_id, Some(42));
        assert_eq!((p.format, p.decoded.as_deref()), (Format::JsonSchema, Some(r#"{"a":1}"#)));
    }

    #[test]
    fn framed_binary_without_a_registry_says_how_to_decode_it() {
        let p = decode(&[0, 0, 0, 0, 7, 0x02, 0x68]);
        assert_eq!((p.schema_id, p.format, p.encoding), (Some(7), Format::Binary, "hex"));
        assert!(p.note.unwrap().contains("registry URL"));
    }

    /// Schema id → registered schema, counting lookups.
    struct Ids(HashMap<u32, Schema>, std::cell::Cell<usize>);

    impl SchemaSource for Ids {
        fn by_id(&self, id: u32) -> Result<Arc<Schema>> {
            self.1.set(self.1.get() + 1);
            self.0.get(&id).cloned().map(Arc::new).ok_or_else(|| Error::msg("Schema not found"))
        }
        fn by_subject(&self, _: &str, _: i32) -> Result<Arc<Schema>> {
            Err(Error::msg("unused"))
        }
    }

    #[test]
    fn framed_avro_decodes_with_the_registry() {
        let schema = Schema {
            schema_type: SchemaType::Avro,
            schema: r#""string""#.into(),
            references: vec![],
            ..Default::default()
        };
        let registry = Ids(HashMap::from([(1, schema)]), Default::default());
        let mut decoder = Decoder::new(Some(&registry));

        // Avro string "hi": zigzag length 2 → 0x04.
        let p = decoder.decode(&[0, 0, 0, 0, 1, 0x04, b'h', b'i']);
        assert_eq!((p.format, p.decoded.as_deref(), p.note), (Format::Avro, Some(r#""hi""#), None));

        let missing = decoder.decode(&[0, 0, 0, 0, 9, 0x04]);
        assert!(missing.note.unwrap().contains("Couldn't load schema 9"));
        decoder.decode(&[0, 0, 0, 0, 9, 0x04]);
        decoder.decode(&[0, 0, 0, 0, 1, 0x00]);
        assert_eq!(registry.1.get(), 2, "each schema is looked up once per decoder, failures too");
    }

    #[test]
    fn encode_frames_what_decode_reads() {
        let avro = Schema { id: Some(5), schema: r#""string""#.into(), ..Default::default() };
        let registry = Ids(HashMap::from([(5, avro.clone())]), Default::default());
        let bytes = encode(&registry, &avro, None, r#""hi""#).unwrap();
        assert_eq!(bytes, [0, 0, 0, 0, 5, 0x04, b'h', b'i']);
        assert_eq!(Decoder::new(Some(&registry)).decode(&bytes).decoded.as_deref(), Some(r#""hi""#));

        let json = Schema { id: Some(6), schema_type: SchemaType::Json, ..Default::default() };
        assert_eq!(encode(&registry, &json, None, r#"{ "a": 1 }"#).unwrap(), b"\x00\x00\x00\x00\x06{\"a\":1}");
        assert!(encode(&registry, &json, None, "{oops").unwrap_err().contains("isn't valid JSON"));
    }
}
