//! Protobuf: decoded by name with a registered `.proto` schema, or field by
//! field without one (like `protoc --decode_raw`).

use std::collections::HashMap;

use prost_reflect::prost::Message as _;
use prost_reflect::{DynamicMessage, FileDescriptor, MessageDescriptor, SerializeOptions};
use protox::file::{ChainFileResolver, File, FileResolver, GoogleFileResolver};
use serde_json::{Map, Value};

use crate::kafka::schema_registry::{Schema as Registered, SchemaSource};

/// The name the registered schema itself is compiled under; imports use their reference names.
const ROOT: &str = "kui-registered.proto";

/// A compiled `.proto` file.
pub struct ProtoSchema {
    file: FileDescriptor,
}

pub fn parse(source: &dyn SchemaSource, registered: &Registered) -> Result<ProtoSchema, String> {
    let mut files = HashMap::from([(ROOT.to_string(), registered.schema.clone())]);
    collect_references(source, registered, &mut files)?;

    let mut resolver = ChainFileResolver::new();
    resolver.add(Sources(files));
    // Well-known types (`google/protobuf/timestamp.proto`, ...) are usually imported without a reference.
    resolver.add(GoogleFileResolver::new());
    let mut compiler = protox::Compiler::with_file_resolver(resolver);
    compiler.include_imports(true);
    compiler.open_file(ROOT).map_err(|e| format!("Invalid Protobuf schema: {e}"))?;
    let file = compiler.descriptor_pool().get_file_by_name(ROOT).ok_or("Protobuf schema didn't compile")?;
    Ok(ProtoSchema { file })
}

fn collect_references(
    source: &dyn SchemaSource,
    schema: &Registered,
    files: &mut HashMap<String, String>,
) -> Result<(), String> {
    for r in &schema.references {
        if files.contains_key(&r.name) {
            continue;
        }
        let referenced = source.by_subject(&r.subject, r.version).map_err(|e| e.to_string())?;
        files.insert(r.name.clone(), referenced.schema.clone());
        collect_references(source, &referenced, files)?;
    }
    Ok(())
}

/// `.proto` sources by import name.
struct Sources(HashMap<String, String>);

impl FileResolver for Sources {
    fn open_file(&self, name: &str) -> Result<File, protox::Error> {
        match self.0.get(name) {
            Some(source) => File::from_source(name, source),
            None => Err(protox::Error::file_not_found(name)),
        }
    }
}

/// A registry-framed Protobuf body (message indexes, then the message) as compact JSON.
pub fn decode(schema: &ProtoSchema, body: &[u8]) -> Result<String, String> {
    let (indexes, message) = message_indexes(body).ok_or("Missing Protobuf message indexes")?;
    let descriptor =
        message_at(&schema.file, &indexes).ok_or_else(|| format!("The schema has no message at index {indexes:?}"))?;
    let decoded = DynamicMessage::decode(descriptor, message).map_err(|e| format!("Not valid for its schema: {e}"))?;
    // Every field, named as in the .proto, so the view matches the schema people know.
    let options = SerializeOptions::new().use_proto_field_name(true).skip_default_fields(false);
    let json = decoded.serialize_with_options(serde_json::value::Serializer, &options).map_err(|e| e.to_string())?;
    Ok(json.to_string())
}

/// Which message in the file the payload is: the first index picks a top-level
/// message, each further one a nested message inside the previous.
fn message_at(file: &FileDescriptor, indexes: &[i64]) -> Option<MessageDescriptor> {
    let (first, rest) = indexes.split_first()?;
    let mut message = file.messages().nth(usize::try_from(*first).ok()?)?;
    for index in rest {
        let child = message.child_messages().nth(usize::try_from(*index).ok()?)?;
        message = child;
    }
    Some(message)
}

/// Every message in the file, nested ones included, with its index path, in declaration order.
fn all_messages(file: &FileDescriptor) -> Vec<(Vec<i64>, MessageDescriptor)> {
    fn walk(path: Vec<i64>, message: MessageDescriptor, out: &mut Vec<(Vec<i64>, MessageDescriptor)>) {
        let children: Vec<_> = message.child_messages().collect();
        out.push((path.clone(), message));
        for (i, child) in children.into_iter().enumerate() {
            // `map<K, V>` fields compile to hidden entry messages; they aren't real choices.
            if !child.is_map_entry() {
                walk([path.as_slice(), &[i as i64]].concat(), child, out);
            }
        }
    }
    let mut out = Vec::new();
    for (i, message) in file.messages().enumerate() {
        walk(vec![i as i64], message, &mut out);
    }
    out
}

/// Full names of the messages a payload can be, e.g. `acme.Order` and `acme.Order.Line`.
pub fn message_names(schema: &ProtoSchema) -> Vec<String> {
    all_messages(&schema.file).into_iter().map(|(_, m)| m.full_name().to_string()).collect()
}

/// Encodes Protobuf JSON as `message` (default: the first one), prefixed with
/// the message indexes a registry-framed payload carries.
pub fn encode(schema: &ProtoSchema, message: Option<&str>, json: &str) -> Result<Vec<u8>, String> {
    let messages = all_messages(&schema.file);
    let (indexes, descriptor) = match message {
        Some(name) => messages.into_iter().find(|(_, m)| m.full_name() == name),
        None => messages.into_iter().next(),
    }
    .ok_or_else(|| format!("The schema has no message {}", message.unwrap_or("at all")))?;

    let mut deserializer = serde_json::Deserializer::from_str(json);
    let decoded = DynamicMessage::deserialize(descriptor, &mut deserializer)
        .and_then(|m| deserializer.end().map(|()| m))
        .map_err(|e| format!("Doesn't match the Protobuf schema: {e}"))?;

    let mut out = encode_indexes(&indexes);
    out.extend(decoded.encode_to_vec());
    Ok(out)
}

fn encode_indexes(indexes: &[i64]) -> Vec<u8> {
    if indexes == [0] {
        return vec![0];
    }
    let mut out = Vec::new();
    for n in std::iter::once(indexes.len() as i64).chain(indexes.iter().copied()) {
        write_varint(&mut out, ((n << 1) ^ (n >> 63)) as u64);
    }
    out
}

fn write_varint(out: &mut Vec<u8>, mut n: u64) {
    while n >= 0x80 {
        out.push((n as u8 & 0x7f) | 0x80);
        n >>= 7;
    }
    out.push(n as u8);
}

/// Splits off Confluent's message-index list: a zigzag varint count, then that
/// many zigzag varints. A count of 0 is shorthand for `[0]`, the first message.
fn message_indexes(body: &[u8]) -> Option<(Vec<i64>, &[u8])> {
    let mut rest = body;
    let count = zigzag(read_varint(&mut rest)?);
    if count == 0 {
        return Some((vec![0], rest));
    }
    if !(1..=100).contains(&count) {
        return None;
    }
    let indexes = (0..count).map(|_| read_varint(&mut rest).map(zigzag)).collect::<Option<_>>()?;
    Some((indexes, rest))
}

fn read_varint(buf: &mut &[u8]) -> Option<u64> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let (&byte, rest) = buf.split_first()?;
        *buf = rest;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

fn zigzag(n: u64) -> i64 {
    (n >> 1) as i64 ^ -((n & 1) as i64)
}

/// Decodes bytes as Protobuf with no schema, keyed by field number. Returns
/// `None` unless every byte parses as well-formed fields. That's only a guess:
/// short binary values can look like Protobuf by chance.
pub fn decode_raw(bytes: &[u8]) -> Option<String> {
    Some(Value::Object(raw_message(bytes, 0)?).to_string())
}

/// Nested messages deeper than this are shown as bytes.
const MAX_DEPTH: usize = 16;

fn raw_message(mut buf: &[u8], depth: usize) -> Option<Map<String, Value>> {
    if buf.is_empty() {
        return None;
    }
    let mut fields: Map<String, Value> = Map::new();
    while !buf.is_empty() {
        let tag = read_varint(&mut buf)?;
        let field = tag >> 3;
        if field == 0 || field > 0x1fff_ffff {
            return None;
        }
        let value = match tag & 7 {
            0 => Value::from(read_varint(&mut buf)?),
            1 => Value::from(u64::from_le_bytes(take(&mut buf, 8)?.try_into().ok()?)),
            2 => {
                let len = usize::try_from(read_varint(&mut buf)?).ok()?;
                raw_bytes(take(&mut buf, len)?, depth)
            }
            5 => Value::from(u32::from_le_bytes(take(&mut buf, 4)?.try_into().ok()?)),
            // 3 and 4 are deprecated groups; 6 and 7 don't exist.
            _ => return None,
        };
        // A repeated field number becomes an array.
        match fields.get_mut(&field.to_string()) {
            Some(Value::Array(items)) => items.push(value),
            Some(existing) => *existing = Value::Array(vec![existing.take(), value]),
            None => {
                fields.insert(field.to_string(), value);
            }
        }
    }
    Some(fields)
}

/// A length-delimited field: readable text, else a nested message, else hex.
fn raw_bytes(bytes: &[u8], depth: usize) -> Value {
    if let Ok(text) = std::str::from_utf8(bytes)
        && super::is_printable(text)
    {
        return Value::from(text);
    }
    if depth < MAX_DEPTH
        && let Some(nested) = raw_message(bytes, depth + 1)
    {
        return Value::Object(nested);
    }
    Value::from(super::hex(bytes))
}

fn take<'a>(buf: &mut &'a [u8], n: usize) -> Option<&'a [u8]> {
    if buf.len() < n {
        return None;
    }
    let (head, rest) = buf.split_at(n);
    *buf = rest;
    Some(head)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::error::{Error, Result};
    use crate::kafka::schema_registry::SchemaType;

    struct Subjects(HashMap<&'static str, &'static str>);

    impl SchemaSource for Subjects {
        fn by_id(&self, _: u32) -> Result<Arc<Registered>> {
            Err(Error::msg("unused"))
        }
        fn by_subject(&self, subject: &str, _: i32) -> Result<Arc<Registered>> {
            let schema = self.0.get(subject).ok_or_else(|| Error::msg("missing"))?.to_string();
            Ok(Arc::new(Registered {
                schema_type: SchemaType::Protobuf,
                schema,
                references: vec![],
                ..Default::default()
            }))
        }
    }

    const ORDER: &str = r#"
        syntax = "proto3";
        package acme;
        import "money.proto";
        message Ping { string id = 1; }
        message Order {
            string id = 1;
            repeated Line lines = 2;
            message Line { string sku = 1; Money price = 2; }
        }"#;
    const MONEY: &str = r#"syntax = "proto3"; package acme; message Money { int64 cents = 1; }"#;

    fn order_schema() -> ProtoSchema {
        let registered: Registered = serde_json::from_value(serde_json::json!({
            "schemaType": "PROTOBUF",
            "schema": ORDER,
            "references": [{"name": "money.proto", "subject": "money", "version": 1}],
        }))
        .unwrap();
        parse(&Subjects(HashMap::from([("money", MONEY)])), &registered).unwrap()
    }

    #[test]
    fn decodes_the_message_the_indexes_point_at() {
        let schema = order_schema();
        let line = message_at(&schema.file, &[1, 0]).unwrap();
        assert_eq!(line.full_name(), "acme.Order.Line");

        let mut msg = DynamicMessage::new(line);
        msg.set_field_by_name("sku", prost_reflect::Value::String("A-1".into()));
        // Indexes [1, 0] → count 2, then 1 and 0, all zigzag-encoded.
        let mut body = vec![4, 2, 0];
        body.extend(msg.encode_to_vec());
        assert_eq!(decode(&schema, &body).unwrap(), r#"{"sku":"A-1"}"#);
    }

    #[test]
    fn zero_count_means_the_first_message() {
        let schema = order_schema();
        // Ping { id: "x" }
        assert_eq!(decode(&schema, &[0, 0x0a, 1, b'x']).unwrap(), r#"{"id":"x"}"#);
    }

    #[test]
    fn raw_decoding_keys_fields_by_number() {
        // 1: 150, 2: "hi", 3: { 1: 1 }, 4: 7, 4: 8
        let bytes = [0x08, 0x96, 0x01, 0x12, 2, b'h', b'i', 0x1a, 2, 0x08, 0x01, 0x20, 7, 0x20, 8];
        assert_eq!(decode_raw(&bytes).unwrap(), r#"{"1":150,"2":"hi","3":{"1":1},"4":[7,8]}"#);
    }

    #[test]
    fn raw_decoding_rejects_what_isnt_protobuf() {
        assert_eq!(decode_raw(&[]), None);
        assert_eq!(decode_raw(&[0x08]), None, "truncated varint");
        assert_eq!(decode_raw(&[0x0b]), None, "group wire type");
        assert_eq!(decode_raw(&[0x12, 5, 1]), None, "length past the end");
    }

    #[test]
    fn lists_messages_with_nested_ones() {
        assert_eq!(message_names(&order_schema()), ["acme.Ping", "acme.Order", "acme.Order.Line"]);
    }

    #[test]
    fn encodes_json_as_the_chosen_message() {
        let schema = order_schema();
        let first = encode(&schema, None, r#"{"id":"x"}"#).unwrap();
        assert_eq!(first, [0, 0x0a, 1, b'x']);

        let json = r#"{"sku":"A-1","price":{"cents":"250"}}"#;
        let line = encode(&schema, Some("acme.Order.Line"), json).unwrap();
        assert_eq!(&line[..3], [4, 2, 0], "indexes [1, 0]");
        assert_eq!(decode(&schema, &line).unwrap(), r#"{"price":{"cents":"250"},"sku":"A-1"}"#);

        assert!(encode(&schema, None, r#"{"nope":1}"#).unwrap_err().contains("Doesn't match"));
        assert!(encode(&schema, Some("acme.Missing"), "{}").is_err());
    }
}
