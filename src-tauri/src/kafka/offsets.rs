use std::collections::HashMap;

use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::{Offset, TopicPartitionList};

use super::TIMEOUT;
use super::probes::Probes;
use crate::error::Result;

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

/// Partitions per committed-offsets request. librdkafka's handling of the
/// response grows quadratically with the list size: 6,054 partitions took
/// 207 ms in one request but 31 ms as 13 requests of up to 500.
const COMMITTED_CHUNK: usize = 500;

/// Offsets `group` has committed on `partitions`. Partitions the group never
/// committed to are omitted.
pub fn committed(probes: &Probes, group: &str, partitions: &[PartitionKey]) -> Result<HashMap<PartitionKey, i64>> {
    if partitions.is_empty() {
        return Ok(HashMap::new());
    }
    let probe = probes.get(group)?;
    let mut offsets = HashMap::new();
    for chunk in partitions.chunks(COMMITTED_CHUNK) {
        let mut tpl = TopicPartitionList::new();
        for (topic, partition) in chunk {
            tpl.add_partition(topic, *partition);
        }
        offsets.extend(probe.committed_offsets(tpl, TIMEOUT)?.elements().iter().filter_map(|e| match e.offset() {
            Offset::Offset(o) => Some(((e.topic().to_string(), e.partition()), o)),
            _ => None, // never committed
        }));
    }
    Ok(offsets)
}

/// `committed` for many groups at once. Each group needs its own probe, and a
/// new one's connection and coordinator lookup (~65 ms locally) is most of a
/// group's cost, so they run on several threads in parallel. 16 halved the
/// time of 8 for 61 groups; 32 gained little more for twice the connections.
pub fn committed_by_group(
    probes: &Probes,
    groups: &[String],
    partitions: &[PartitionKey],
) -> Vec<(String, Result<HashMap<PartitionKey, i64>>)> {
    const THREADS: usize = 16;
    if groups.is_empty() {
        return Vec::new();
    }
    let chunk = groups.len().div_ceil(THREADS);
    std::thread::scope(|s| {
        let handles: Vec<_> = groups
            .chunks(chunk)
            .map(|chunk| {
                s.spawn(move || chunk.iter().map(|g| (g.clone(), committed(probes, g, partitions))).collect::<Vec<_>>())
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().expect("offset probe panicked")).collect()
    })
}
