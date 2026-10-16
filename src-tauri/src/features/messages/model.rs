use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::kafka::schema_registry::SchemaType;

/// Where to start reading from.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum StartFrom {
    /// From the end of each partition, newest first.
    Latest,
    /// From the beginning of each partition.
    Earliest,
    /// From a specific offset (`BrowseRequest::value`).
    Offset,
    /// From the first message at/after an epoch-millis timestamp (`BrowseRequest::value`).
    Timestamp,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseRequest {
    pub topic: String,
    /// `None` means all partitions.
    pub partition: Option<i32>,
    pub from: StartFrom,
    pub value: Option<i64>,
    pub page_size: usize,
    /// Where to continue: `BrowsePage::next` of the previous page. `None` reads the first page.
    #[serde(default)]
    pub cursor: Option<BTreeMap<i32, i64>>,
}

/// One page of a topic, newest first for `StartFrom::Latest`, otherwise oldest first.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowsePage {
    pub messages: Vec<Message>,
    /// Offsets from the start position to the end of the topic in the reading
    /// direction. Compacted topics have gaps, so it can overcount.
    pub total: i64,
    /// Cursor for the following page, or `None` on the last one.
    pub next: Option<BTreeMap<i32, i64>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TailRequest {
    pub topic: String,
    /// `None` means all partitions.
    pub partition: Option<i32>,
}

/// Message bytes rendered for display.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Payload {
    /// The bytes as they are: text for printable UTF-8, otherwise space-separated hex.
    pub text: String,
    /// `utf8` or `hex`, saying which of the two `text` is.
    pub encoding: &'static str,
    pub size: usize,
    /// What the bytes were recognised as.
    pub format: Format,
    /// Compact JSON for formats that aren't readable as they are (Avro,
    /// Protobuf, MessagePack, registry-framed JSON).
    pub decoded: Option<String>,
    /// Schema Registry id, when the bytes start with the registry's header.
    pub schema_id: Option<u32>,
    /// Why the bytes couldn't be decoded, or a caveat about how they were.
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Format {
    Json,
    Xml,
    Text,
    Avro,
    Protobuf,
    /// JSON written with a Schema Registry JSON Schema.
    JsonSchema,
    Msgpack,
    /// Not recognised; only the raw bytes are shown.
    Binary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageHeader {
    pub key: String,
    pub value: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub partition: i32,
    pub offset: i64,
    /// Epoch millis.
    pub timestamp: Option<i64>,
    pub key: Option<Payload>,
    pub value: Option<Payload>,
    pub headers: Vec<MessageHeader>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProduceRequest {
    pub topic: String,
    /// `None` lets the partitioner decide (by key hash).
    pub partition: Option<i32>,
    pub key: Option<String>,
    pub value: Option<String>,
    #[serde(default)]
    pub headers: Vec<ProduceHeader>,
    /// Encode `value` (JSON) with a registered schema instead of sending it as text.
    #[serde(default)]
    pub value_schema: Option<ValueSchema>,
}

/// Which registered schema to encode a produced value with.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ValueSchema {
    /// The subject's latest version is used, e.g. `orders-value`.
    pub subject: String,
    /// Protobuf only: the message's full name; `None` means the first in the file.
    #[serde(default)]
    pub message: Option<String>,
}

/// A subject's latest schema, for writing a message that fits it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectSchema {
    pub id: Option<u32>,
    pub version: Option<i32>,
    pub schema_type: SchemaType,
    pub schema: String,
    /// Protobuf message names to choose from; empty for Avro and JSON Schema.
    pub messages: Vec<String>,
}

#[derive(Deserialize)]
pub struct ProduceHeader {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivered {
    pub partition: i32,
    pub offset: i64,
}

/// Re-produces one existing message, byte for byte, to a topic (the same one = duplicate).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyRequest {
    pub topic: String,
    pub partition: i32,
    pub offset: i64,
    pub target_topic: String,
    /// `None` lets the partitioner decide (by key hash).
    pub target_partition: Option<i32>,
}
