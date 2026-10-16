use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::error::KafkaError;
use rdkafka::message::{BorrowedMessage, Header, Headers, OwnedHeaders, OwnedMessage};
use rdkafka::producer::FutureRecord;
use rdkafka::{Message as _, Offset, TopicPartitionList};

use super::codec::decode;
use super::model::{
    BrowsePage, BrowseRequest, CopyRequest, Delivered, Message, MessageHeader, ProduceRequest, StartFrom, TailRequest,
};
use super::window::{PartitionRead, ReadWindow, merge_page, page_window, remaining, start_position};
use crate::blocking::run_blocking;
use crate::error::{Error, Result};
use crate::kafka::metadata::{ensure_writable, partition_ids};
use crate::kafka::offsets::{PartitionKey, Watermarks, offsets_at, watermarks};
use crate::kafka::{KafkaClients, TIMEOUT, client_config};
use crate::tasks::CancelToken;

const MAX_PAGE_SIZE: usize = 1000;

/// Reads one page of messages, continuing from `request.cursor` if given.
///
/// Each partition reads at most one page's worth from its cursor; the reads are
/// merged by time (see `window::merge_page`). Uses a fresh consumer with manual
/// partition assignment and no commits, so browsing never affects a real consumer group.
pub fn browse(clients: &KafkaClients, request: &BrowseRequest) -> Result<BrowsePage> {
    let size = request.page_size.clamp(1, MAX_PAGE_SIZE);
    let backward = request.from == StartFrom::Latest;
    let consumer = browsing_consumer(clients)?;

    let partitions = plan_partitions(&consumer, request)?;
    let total = partitions.iter().map(|p| remaining(p.start, p.marks, backward)).sum();
    let position = |p: &PartitionPlan| request.cursor.as_ref().and_then(|c| c.get(&p.id)).copied().unwrap_or(p.start);

    let windows: HashMap<i32, ReadWindow> = partitions
        .iter()
        .filter_map(|p| Some((p.id, page_window(position(p), p.marks, size as i64, backward)?)))
        .collect();
    let mut by_partition: HashMap<i32, Vec<Message>> = HashMap::new();
    if !windows.is_empty() {
        let mut assignment = TopicPartitionList::new();
        for (partition, window) in &windows {
            assignment.add_partition_offset(&request.topic, *partition, Offset::Offset(window.start))?;
        }
        consumer.assign(&assignment)?;
        for message in read_until_done(&consumer, windows.clone())? {
            by_partition.entry(message.partition).or_default().push(message);
        }
    }

    let reads = windows
        .into_iter()
        .map(|(partition, window)| {
            let mut messages = by_partition.remove(&partition).unwrap_or_default();
            messages.sort_by_key(|m| m.offset);
            PartitionRead { partition, window, messages }
        })
        .collect();
    let (messages, mut next) = merge_page(reads, size, backward);

    // Partitions that had nothing to read stay where they were.
    for p in &partitions {
        next.entry(p.id).or_insert_with(|| position(p).clamp(p.marks.low, p.marks.high));
    }
    let more = partitions.iter().any(|p| remaining(next[&p.id], p.marks, backward) > 0);
    Ok(BrowsePage { messages, total, next: more.then_some(next) })
}

/// How often a live tail hands new messages to the UI, and the most it sends at once.
const TAIL_FLUSH_EVERY: Duration = Duration::from_millis(250);
const TAIL_MAX_BATCH: usize = 500;

/// Streams messages as they arrive, starting from the end of each partition.
///
/// Calls `emit` with small batches until `cancel` fires or `emit` returns false
/// (the UI went away). Like `browse`, it never joins or commits for a real group.
pub fn tail(
    clients: &KafkaClients,
    request: &TailRequest,
    cancel: &CancelToken,
    mut emit: impl FnMut(Vec<Message>) -> bool,
) -> Result<()> {
    let consumer = browsing_consumer(clients)?;
    let mut assignment = TopicPartitionList::new();
    for id in partition_ids(&consumer, &request.topic)? {
        if request.partition.is_none_or(|wanted| wanted == id) {
            assignment.add_partition_offset(&request.topic, id, Offset::End)?;
        }
    }
    if assignment.count() == 0 {
        return Err(Error::msg("No matching partitions"));
    }
    consumer.assign(&assignment)?;

    let mut batch = Vec::new();
    let mut last_flush = Instant::now();
    while !cancel.is_cancelled() {
        match consumer.poll(Duration::from_millis(100)) {
            None | Some(Err(KafkaError::PartitionEOF(_))) => {}
            Some(Err(e)) => return Err(e.into()),
            Some(Ok(m)) => batch.push(to_message(&m)),
        }
        let due = last_flush.elapsed() >= TAIL_FLUSH_EVERY || batch.len() >= TAIL_MAX_BATCH;
        if due && !batch.is_empty() {
            if !emit(std::mem::take(&mut batch)) {
                break;
            }
            last_flush = Instant::now();
        }
    }
    Ok(())
}

fn browsing_consumer(clients: &KafkaClients) -> Result<BaseConsumer> {
    Ok(client_config(&clients.cluster)
        .set("group.id", format!("kui-browser-{}", uuid::Uuid::new_v4()))
        .set("enable.auto.commit", "false")
        .set("enable.partition.eof", "true")
        .create()?)
}

/// A requested partition, its watermarks, and where the first page starts in it.
struct PartitionPlan {
    id: i32,
    marks: Watermarks,
    start: i64,
}

fn plan_partitions(consumer: &BaseConsumer, request: &BrowseRequest) -> Result<Vec<PartitionPlan>> {
    let keys: Vec<PartitionKey> = partition_ids(consumer, &request.topic)?
        .into_iter()
        .filter(|id| request.partition.is_none_or(|wanted| wanted == *id))
        .map(|id| (request.topic.clone(), id))
        .collect();
    if keys.is_empty() {
        return Err(Error::msg("No matching partitions"));
    }

    let marks = watermarks(consumer, &keys)?;
    let seeks: HashMap<PartitionKey, i64> = match request.from {
        StartFrom::Offset => {
            let offset = request.value.ok_or_else(|| Error::msg("Offset is required"))?;
            keys.iter().map(|k| (k.clone(), offset)).collect()
        }
        StartFrom::Timestamp => {
            let ts = request.value.ok_or_else(|| Error::msg("Timestamp is required"))?;
            offsets_at(consumer, &keys, Offset::Offset(ts))?
        }
        StartFrom::Latest | StartFrom::Earliest => HashMap::new(),
    };

    Ok(keys
        .iter()
        .map(|key| {
            let marks = marks.get(key).copied().unwrap_or_default();
            PartitionPlan { id: key.1, marks, start: start_position(request.from, marks, seeks.get(key).copied()) }
        })
        .collect())
}

/// Polls until every partition has reached the end of its window, or we time out.
fn read_until_done(consumer: &BaseConsumer, mut pending: HashMap<i32, ReadWindow>) -> Result<Vec<Message>> {
    let mut messages = Vec::new();
    let deadline = Instant::now() + TIMEOUT;

    while !pending.is_empty() && Instant::now() < deadline {
        match consumer.poll(Duration::from_millis(200)) {
            None => {}
            Some(Err(KafkaError::PartitionEOF(partition))) => {
                pending.remove(&partition);
            }
            Some(Err(e)) => return Err(e.into()),
            Some(Ok(m)) => {
                let Some(window) = pending.get(&m.partition()).copied() else {
                    continue;
                };
                if m.offset() < window.end {
                    messages.push(to_message(&m));
                }
                // Compacted/transactional topics can skip offsets, so compare with `>=`.
                if m.offset() + 1 >= window.end {
                    pending.remove(&m.partition());
                }
            }
        }
    }
    Ok(messages)
}

fn to_message(m: &BorrowedMessage<'_>) -> Message {
    let headers = m
        .headers()
        .map(|hs| {
            hs.iter()
                .map(|h| MessageHeader { key: h.key.to_string(), value: h.value.map(|v| decode(v).text) })
                .collect()
        })
        .unwrap_or_default();

    Message {
        partition: m.partition(),
        offset: m.offset(),
        timestamp: m.timestamp().to_millis(),
        key: m.key().map(decode),
        value: m.payload().map(decode),
        headers,
    }
}

pub async fn produce(clients: &KafkaClients, request: &ProduceRequest) -> Result<Delivered> {
    ensure_writable(&request.topic)?;
    let headers = request
        .headers
        .iter()
        .fold(OwnedHeaders::new(), |hs, h| hs.insert(Header { key: &h.key, value: Some(h.value.as_bytes()) }));

    let mut record: FutureRecord<'_, str, str> = FutureRecord::to(&request.topic).headers(headers);
    if let Some(key) = request.key.as_deref().filter(|k| !k.is_empty()) {
        record = record.key(key);
    }
    if let Some(value) = request.value.as_deref() {
        record = record.payload(value);
    }
    if let Some(partition) = request.partition {
        record = record.partition(partition);
    }

    let delivery = clients.producer.send(record, TIMEOUT).await.map_err(|(e, _)| Error::from(e))?;
    Ok(Delivered { partition: delivery.partition, offset: delivery.offset })
}

/// Copies one message to `target_topic`, keeping its key, value and headers as raw bytes.
/// The original is never touched: a Kafka log is append-only, so KUI only adds a copy,
/// appended as a new message stamped "now" like any other.
pub async fn copy(clients: Arc<KafkaClients>, request: &CopyRequest) -> Result<Delivered> {
    ensure_writable(&request.target_topic)?;
    let (topic, partition, offset) = (request.topic.clone(), request.partition, request.offset);
    let reader = clients.clone();
    let original = run_blocking(move || fetch_one(&reader, &topic, partition, offset)).await?;

    let mut record: FutureRecord<'_, [u8], [u8]> = FutureRecord::to(&request.target_topic);
    if let Some(key) = original.key() {
        record = record.key(key);
    }
    if let Some(value) = original.payload() {
        record = record.payload(value);
    }
    if let Some(headers) = original.headers() {
        record = record.headers(headers.clone());
    }
    if let Some(partition) = request.target_partition {
        record = record.partition(partition);
    }

    let delivery = clients.producer.send(record, TIMEOUT).await.map_err(|(e, _)| Error::from(e))?;
    Ok(Delivered { partition: delivery.partition, offset: delivery.offset })
}

/// Reads exactly one message, or fails if it was deleted or compacted away.
fn fetch_one(clients: &KafkaClients, topic: &str, partition: i32, offset: i64) -> Result<OwnedMessage> {
    let consumer = browsing_consumer(clients)?;
    let mut assignment = TopicPartitionList::new();
    assignment.add_partition_offset(topic, partition, Offset::Offset(offset))?;
    consumer.assign(&assignment)?;

    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline {
        match consumer.poll(Duration::from_millis(200)) {
            None => {}
            Some(Ok(m)) if m.offset() == offset => return Ok(m.detach()),
            // Landed somewhere else: the offset is gone (retention, compaction, deletion).
            Some(Ok(_)) | Some(Err(KafkaError::PartitionEOF(_))) => break,
            Some(Err(e)) => return Err(e.into()),
        }
    }
    Err(Error::msg(format!("Message at partition {partition}, offset {offset} no longer exists")))
}
