use std::collections::HashMap;

use rdkafka::consumer::Consumer;

use super::model::{Broker, ClusterOverview};
use crate::error::Result;
use crate::kafka::{KafkaClients, TIMEOUT};

pub fn cluster_overview(clients: &KafkaClients) -> Result<ClusterOverview> {
    let md = clients.metadata.fetch_metadata(None, TIMEOUT)?;

    let mut leader_count: HashMap<i32, usize> = HashMap::new();
    let mut replica_count: HashMap<i32, usize> = HashMap::new();
    let mut overview = ClusterOverview {
        brokers: Vec::new(),
        topic_count: md.topics().len(),
        partition_count: 0,
        under_replicated_partitions: 0,
        offline_partitions: 0,
    };

    for partition in md.topics().iter().flat_map(|t| t.partitions()) {
        overview.partition_count += 1;
        if partition.leader() < 0 {
            overview.offline_partitions += 1;
        } else {
            *leader_count.entry(partition.leader()).or_default() += 1;
        }
        if partition.isr().len() < partition.replicas().len() {
            overview.under_replicated_partitions += 1;
        }
        for replica in partition.replicas() {
            *replica_count.entry(*replica).or_default() += 1;
        }
    }

    overview.brokers = md
        .brokers()
        .iter()
        .map(|b| Broker {
            id: b.id(),
            host: b.host().to_string(),
            port: b.port(),
            leader_partitions: leader_count.get(&b.id()).copied().unwrap_or(0),
            replica_partitions: replica_count.get(&b.id()).copied().unwrap_or(0),
        })
        .collect();
    overview.brokers.sort_by_key(|b| b.id);

    Ok(overview)
}
