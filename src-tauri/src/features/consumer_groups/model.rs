use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSummary {
    pub name: String,
    /// e.g. `Stable`, `Empty`, `PreparingRebalance`, `Dead`.
    pub state: String,
    pub protocol_type: String,
    /// Partition assignor, e.g. `range` or `cooperative-sticky`.
    pub protocol: String,
    pub members: usize,
}

/// Lag for one group, fetched separately from `GroupSummary` because it needs
/// one offset request per group.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupLag {
    pub name: String,
    /// Topics the group has committed to or is assigned.
    pub topics: Vec<String>,
    /// `None` when the group's offsets could not be read.
    pub lag: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMember {
    pub id: String,
    pub client_id: String,
    pub host: String,
    /// topic -> assigned partitions
    pub assignment: BTreeMap<String, Vec<i32>>,
}

/// Where a group stands on one partition.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PartitionStatus {
    /// Nothing committed yet: the group has never consumed this partition.
    NotStarted,
    /// Committed offset is below the end: messages are waiting.
    Behind,
    /// Committed offset is at the end: everything has been consumed.
    CaughtUp,
    /// Committed offset is below the log start: retention deleted messages
    /// before the group read them.
    OutOfRange,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PartitionOffset {
    pub topic: String,
    pub partition: i32,
    /// First offset still on the broker.
    pub low: i64,
    /// Next offset to be written.
    pub high: i64,
    /// Next offset the group will read; `None` if it never committed here.
    pub committed: Option<i64>,
    /// `high - committed`; `None` if it never committed here.
    pub lag: Option<i64>,
    pub status: PartitionStatus,
    /// Client id of the member currently assigned this partition.
    pub owner: Option<String>,
}

/// One topic from a group's point of view. `consumed + lag + untouched` is the
/// number of messages on the broker (except for out-of-range partitions).
#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TopicProgress {
    pub topic: String,
    pub partitions: usize,
    pub caught_up: usize,
    pub behind: usize,
    pub not_started: usize,
    pub out_of_range: usize,
    /// Retained messages before the committed offsets.
    pub consumed: i64,
    pub lag: i64,
    /// Messages in partitions the group never committed to.
    pub untouched: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDetail {
    pub name: String,
    pub state: String,
    pub members: Vec<GroupMember>,
    pub topics: Vec<TopicProgress>,
    /// Every partition of every topic in `topics`, sorted by topic and partition.
    pub offsets: Vec<PartitionOffset>,
    pub total_lag: i64,
}

/// How far one group has read a given topic.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicConsumer {
    pub group: String,
    pub state: String,
    pub members: usize,
    pub progress: TopicProgress,
    pub offsets: Vec<PartitionOffset>,
}
