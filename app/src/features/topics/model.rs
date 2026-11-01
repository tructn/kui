use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicSummary {
    pub name: String,
    pub partitions: usize,
    pub replication_factor: usize,
    pub internal: bool,
    /// Sum of (high - low) watermarks; approximate for compacted topics.
    pub message_count: i64,
    pub under_replicated_partitions: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Partition {
    pub id: i32,
    pub leader: i32,
    pub replicas: Vec<i32>,
    pub isr: Vec<i32>,
    pub low: i64,
    pub high: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicConfigEntry {
    pub name: String,
    pub value: Option<String>,
    /// Where the value comes from, e.g. `Default`, `DynamicTopic`, `StaticBroker`.
    pub source: String,
    pub is_default: bool,
    pub is_read_only: bool,
    pub is_sensitive: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicDetail {
    pub name: String,
    /// Kafka's or a platform tool's topic; shown read-only (see `kafka::metadata::is_internal`).
    pub internal: bool,
    pub partitions: Vec<Partition>,
    pub configs: Vec<TopicConfigEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTopicRequest {
    pub name: String,
    pub partitions: i32,
    pub replication_factor: i32,
    /// Topic-level overrides such as `cleanup.policy` or `retention.ms`.
    #[serde(default)]
    pub configs: BTreeMap<String, String>,
}

/// Outcome of deleting one topic in a batch: Kafka deletes each topic independently.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTopicResult {
    pub topic: String,
    /// `None` when the topic was deleted.
    pub error: Option<String>,
}
