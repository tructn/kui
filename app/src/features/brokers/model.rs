use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Broker {
    pub id: i32,
    pub host: String,
    pub port: i32,
    /// Partitions this broker currently leads.
    pub leader_partitions: usize,
    /// Partitions this broker holds a replica of (including the ones it leads).
    pub replica_partitions: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterOverview {
    pub brokers: Vec<Broker>,
    pub topic_count: usize,
    pub partition_count: usize,
    /// Partitions whose in-sync replica set is smaller than the replica set.
    pub under_replicated_partitions: usize,
    /// Partitions with no leader.
    pub offline_partitions: usize,
}
