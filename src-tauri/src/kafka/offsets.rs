use std::collections::{HashMap, HashSet};

use rdkafka::admin::AdminClient;
use rdkafka::client::DefaultClientContext;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::{Offset, TopicPartitionList};

use super::{TIMEOUT, group_offsets};
use crate::error::Result;

type Admin = AdminClient<DefaultClientContext>;

/// (topic, partition)
pub type PartitionKey = (String, i32);

/// Lowest and next-to-be-written offset of a partition.
#[derive(Debug, Clone, Copy, Default)]
pub struct Watermarks {
    pub low: i64,
    pub high: i64,
}

impl Watermarks {
    pub fn message_count(&self) -> i64 {
        self.high - self.low
    }
}

/// Watermarks for many partitions in two batched ListOffsets requests
/// (timestamp -2 = earliest, -1 = latest) instead of one round trip per
/// partition. The two run in parallel, so it costs one round trip, not two.
pub fn watermarks(consumer: &BaseConsumer, partitions: &[PartitionKey]) -> Result<HashMap<PartitionKey, Watermarks>> {
    if partitions.is_empty() {
        return Ok(HashMap::new());
    }
    let (lows, highs) = std::thread::scope(|s| {
        let lows = s.spawn(|| offsets_at(consumer, partitions, Offset::Beginning));
        let highs = offsets_at(consumer, partitions, Offset::End);
        (lows.join().expect("watermark lookup panicked"), highs)
    });
    let (lows, highs) = (lows?, highs?);

    Ok(partitions
        .iter()
        .map(|key| {
            let low = lows.get(key).copied().unwrap_or(0);
            let high = highs.get(key).copied().unwrap_or(low);
            (key.clone(), Watermarks { low, high })
        })
        .collect())
}

/// Resolves a logical offset or a timestamp (`Offset::Offset(epoch_ms)`) to a
/// concrete offset for each partition. Partitions without an answer are omitted.
pub fn offsets_at(
    consumer: &BaseConsumer,
    partitions: &[PartitionKey],
    at: Offset,
) -> Result<HashMap<PartitionKey, i64>> {
    let mut tpl = TopicPartitionList::new();
    for (topic, partition) in partitions {
        tpl.add_partition_offset(topic, *partition, at)?;
    }
    let resolved = consumer.offsets_for_times(tpl, TIMEOUT)?;
    Ok(resolved
        .elements()
        .iter()
        .filter_map(|e| match e.offset() {
            Offset::Offset(o) => Some(((e.topic().to_string(), e.partition()), o)),
            _ => None,
        })
        .collect())
}

/// Offsets `group` has committed on `partitions`. Partitions the group never
/// committed to are omitted.
pub fn committed(admin: &Admin, group: &str, partitions: &[PartitionKey]) -> Result<HashMap<PartitionKey, i64>> {
    let (_, result) = committed_by_group(admin, &[group.to_string()], partitions).pop().expect("one result per group");
    result
}

/// `committed` for many groups at once, all requests in flight together.
pub fn committed_by_group(
    admin: &Admin,
    groups: &[String],
    partitions: &[PartitionKey],
) -> Vec<(String, Result<HashMap<PartitionKey, i64>>)> {
    let wanted: HashSet<&PartitionKey> = partitions.iter().collect();
    let results = group_offsets::list(admin, groups);
    groups
        .iter()
        .cloned()
        .zip(results)
        .map(|(group, result)| (group, result.map(|all| all.into_iter().filter(|(k, _)| wanted.contains(k)).collect())))
        .collect()
}
