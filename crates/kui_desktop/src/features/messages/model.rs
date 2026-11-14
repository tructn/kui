use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

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
    /// Filter (see `query`); blank or `None` returns every message.
    #[serde(default)]
    pub query: Option<String>,
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
    /// With a query: how many messages were read to find this page's matches.
    /// A page can come back short (or empty) when the search budget ran out
    /// before the topic did; `next` then continues the search.
    pub scanned: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TailRequest {
    pub topic: String,
    /// `None` means all partitions.
    pub partition: Option<i32>,
    /// Only stream messages matching this filter.
    #[serde(default)]
    pub query: Option<String>,
}

/// Message bytes rendered for display.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Payload {
    pub text: String,
    /// `utf8` when the bytes were valid UTF-8, otherwise `hex`.
    pub encoding: &'static str,
    pub size: usize,
    /// `text` is a prefix of the payload: the page's byte budget ran out. `size` is still the full length.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
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
