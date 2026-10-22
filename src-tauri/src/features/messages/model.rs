use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

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

#[derive(Deserialize, Clone)]
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
    pub text: String,
    /// `utf8` when the bytes were valid UTF-8, otherwise `hex`.
    pub encoding: &'static str,
    pub size: usize,
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

/// Re-produces existing messages, byte for byte, to a topic (the same one = duplicate).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyRequest {
    pub topic: String,
    /// Copied in this order.
    pub messages: Vec<MessageRef>,
    pub target_topic: String,
    /// `None` lets the partitioner decide (by key hash).
    pub target_partition: Option<i32>,
}

/// Where one message sits in its topic.
#[derive(Deserialize)]
pub struct MessageRef {
    pub partition: i32,
    pub offset: i64,
}

/// File formats messages can be exported to.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    /// One JSON array.
    Json,
    /// One JSON object per line.
    Ndjson,
    Csv,
}

impl ExportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Json => "json",
            ExportFormat::Ndjson => "ndjson",
            ExportFormat::Csv => "csv",
        }
    }
}

/// Which messages to export.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ExportSource {
    /// Messages in browse order, starting at `browse` (its cursor included),
    /// until `limit` are read or the topic ends.
    Range { browse: BrowseRequest, limit: usize },
    /// Specific messages, e.g. the rows checked in the table.
    Messages { topic: String, messages: Vec<MessageRef> },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub source: ExportSource,
    pub format: ExportFormat,
}

impl ExportRequest {
    pub fn topic(&self) -> &str {
        match &self.source {
            ExportSource::Range { browse, .. } => &browse.topic,
            ExportSource::Messages { topic, .. } => topic,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exported {
    pub path: String,
    pub count: usize,
}
