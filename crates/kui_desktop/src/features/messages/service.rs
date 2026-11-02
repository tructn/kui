use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rdkafka::consumer::Consumer;
use rdkafka::error::KafkaError;
use rdkafka::message::{Header, Headers, OwnedHeaders, OwnedMessage};
use rdkafka::producer::FutureRecord;
use rdkafka::{Message as _, Offset, TopicPartitionList};

use super::codec::decode;
use super::export::ExportWriter;
use super::model::{
    BrowsePage, BrowseRequest, CopyRequest, Delivered, ExportRequest, ExportSource, Message, MessageHeader,
    ProduceRequest, StartFrom, TailRequest,
};
use super::query;
use super::window::{
    Cursor, PartitionRead, ReadWindow, merge_page, page_window, remaining, resume_after, start_position,
};
use crate::blocking::run_blocking;
use crate::error::{Error, Result};
use crate::tasks::CancelToken;
use kui_kafka::connection::{ConnectionErrors, explain};
use kui_kafka::metadata::{ensure_writable, partition_ids};
use kui_kafka::offsets::{PartitionKey, Watermarks, offsets_at, watermarks};
use kui_kafka::{KafkaClients, KafkaConsumer, TIMEOUT, client_config};

const MAX_PAGE_SIZE: usize = 1000;

/// Reads one page of messages, continuing from `request.cursor` if given.
///
/// Each partition reads at most one page's worth from its cursor; the reads are
/// merged by time (see `window::merge_page`). Uses a fresh consumer with manual
/// partition assignment and no commits, so browsing never affects a real consumer group.
pub fn browse(clients: &KafkaClients, request: &BrowseRequest) -> Result<BrowsePage> {
    browse_with(&browsing_consumer(clients)?, request)
}

/// `browse` on an existing browsing consumer, so several pages can share one.
fn browse_with(consumer: &KafkaConsumer, request: &BrowseRequest) -> Result<BrowsePage> {
    // Parse first: a typo should fail fast, before any reading.
    let query = query::optional(request.query.as_deref())?;
    let size = request.page_size.clamp(1, MAX_PAGE_SIZE);
    let backward = request.from == StartFrom::Latest;

    let partitions = plan_partitions(consumer, request)?;
    let total = partitions.iter().map(|p| remaining(p.start, p.marks, backward)).sum();
    let start: Cursor = partitions
        .iter()
        .map(|p| (p.id, request.cursor.as_ref().and_then(|c| c.get(&p.id)).copied().unwrap_or(p.start)))
        .collect();
    let reader = PageReader { consumer, topic: &request.topic, partitions: &partitions, backward };

    let Some(query) = query else {
        let (messages, next) = reader.read(&start, size)?;
        return Ok(BrowsePage { messages, total, next, scanned: None });
    };

    // Search: read raw pages and keep the matches until the page is full, the
    // topic ends, or the budget runs out (the UI offers to keep going from `next`).
    let deadline = Instant::now() + SEARCH_TIME_BUDGET;
    let mut matches = Vec::with_capacity(size);
    let mut scanned = 0u64;
    let mut cursor = start;
    loop {
        let (raw, next) = reader.read(&cursor, SEARCH_CHUNK)?;
        let mut consumed = Vec::with_capacity(raw.len());
        for message in raw {
            scanned += 1;
            consumed.push((message.partition, message.offset));
            if query.matches(&message) {
                matches.push(message);
                if matches.len() == size {
                    break;
                }
            }
        }
        if matches.len() == size {
            // Full mid-chunk: resume right after the last message looked at.
            let resumed = resume_after(&cursor, &consumed, backward);
            let more = partitions.iter().any(|p| remaining(resumed[&p.id], p.marks, backward) > 0);
            return Ok(BrowsePage { messages: matches, total, next: more.then_some(resumed), scanned: Some(scanned) });
        }
        let Some(next) = next else {
            return Ok(BrowsePage { messages: matches, total, next: None, scanned: Some(scanned) });
        };
        // Out of budget, or no progress (so it can never spin): hand back what we have.
        let stalled = consumed.is_empty() && next == cursor;
        cursor = next;
        if stalled || scanned >= SEARCH_SCAN_BUDGET || Instant::now() >= deadline {
            return Ok(BrowsePage { messages: matches, total, next: Some(cursor), scanned: Some(scanned) });
        }
    }
}

/// How many messages a search reads at a time.
const SEARCH_CHUNK: usize = 500;
/// Most messages one page of search results reads before handing back what it found.
const SEARCH_SCAN_BUDGET: u64 = 50_000;
/// …or how long it may take, so the UI stays responsive on slow clusters.
const SEARCH_TIME_BUDGET: Duration = Duration::from_secs(5);

/// Reads raw pages of one topic's planned partitions.
struct PageReader<'a> {
    consumer: &'a KafkaConsumer,
    topic: &'a str,
    partitions: &'a [PartitionPlan],
    backward: bool,
}

impl PageReader<'_> {
    /// Up to `size` messages from `cursor` (a position for every partition), and
    /// the cursor after them, or `None` when nothing is left.
    fn read(&self, cursor: &Cursor, size: usize) -> Result<(Vec<Message>, Option<Cursor>)> {
        let backward = self.backward;
        let windows: HashMap<i32, ReadWindow> = self
            .partitions
            .iter()
            .filter_map(|p| Some((p.id, page_window(cursor[&p.id], p.marks, size as i64, backward)?)))
            .collect();
        let mut by_partition: HashMap<i32, Vec<Message>> = HashMap::new();
        if !windows.is_empty() {
            let mut assignment = TopicPartitionList::new();
            for (partition, window) in &windows {
                assignment.add_partition_offset(self.topic, *partition, Offset::Offset(window.start))?;
            }
            self.consumer.assign(&assignment)?;
            for message in read_until_done(self.consumer, windows.clone())? {
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
        for p in self.partitions {
            next.entry(p.id).or_insert_with(|| cursor[&p.id].clamp(p.marks.low, p.marks.high));
        }
        let more = self.partitions.iter().any(|p| remaining(next[&p.id], p.marks, backward) > 0);
        Ok((messages, more.then_some(next)))
    }
}

/// Most messages one export reads.
pub const MAX_EXPORT: usize = 100_000;

/// Exports messages to `path`, returning how many were written.
///
/// Writes to `<path>.part` first and renames it at the end, so a failed export
/// never leaves a half-written file under the chosen name.
pub fn export_to_file(clients: &KafkaClients, request: &ExportRequest, path: &Path) -> Result<usize> {
    let mut part = path.as_os_str().to_owned();
    part.push(".part");
    let part = Path::new(&part);
    let written = File::create(part).map_err(Error::from).and_then(|file| {
        let mut out = BufWriter::new(file);
        let count = export(clients, request, &mut out)?;
        out.into_inner().map_err(|e| e.into_error())?.sync_all()?;
        Ok(count)
    });
    match written {
        Ok(count) => {
            std::fs::rename(part, path)?;
            Ok(count)
        }
        Err(e) => {
            let _ = std::fs::remove_file(part);
            Err(e)
        }
    }
}

/// Writes the messages `request` selects to `out`, one page at a time.
pub fn export(clients: &KafkaClients, request: &ExportRequest, out: impl Write) -> Result<usize> {
    let consumer = browsing_consumer(clients)?;
    let mut writer = ExportWriter::new(out, request.format, request.topic())?;
    match &request.source {
        ExportSource::Range { browse, limit } => {
            let mut left = (*limit).clamp(1, MAX_EXPORT);
            let mut cursor = browse.cursor.clone();
            while left > 0 {
                let page_request = BrowseRequest { page_size: left.min(MAX_PAGE_SIZE), cursor, ..browse.clone() };
                let page = browse_with(&consumer, &page_request)?;
                for message in page.messages.iter().take(left) {
                    writer.write(message)?;
                }
                left -= page.messages.len().min(left);
                // Stop at the end, or if a page made no progress (so it can never spin).
                match page.next {
                    Some(next) if !page.messages.is_empty() || page_request.cursor.as_ref() != Some(&next) => {
                        cursor = Some(next)
                    }
                    _ => break,
                }
            }
        }
        ExportSource::Messages { topic, messages } => {
            if messages.is_empty() {
                return Err(Error::msg("No messages to export"));
            }
            let mut refs: Vec<(i32, i64)> = messages.iter().map(|m| (m.partition, m.offset)).collect();
            refs.sort_unstable();
            refs.dedup();
            for (partition, offset) in refs {
                writer.write(&to_message(&fetch_one(&consumer, topic, partition, offset)?))?;
            }
        }
    }
    writer.finish()
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
    let query = query::optional(request.query.as_deref())?;
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
            Some(Err(e)) => return Err(explain(&consumer, e).into()),
            Some(Ok(m)) => {
                let message = to_message(&m);
                if query.as_ref().is_none_or(|q| q.matches(&message)) {
                    batch.push(message);
                }
            }
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

fn browsing_consumer(clients: &KafkaClients) -> Result<KafkaConsumer> {
    Ok(client_config(&clients.cluster)
        .set("group.id", format!("kui-browser-{}", uuid::Uuid::new_v4()))
        .set("enable.auto.commit", "false")
        .set("enable.partition.eof", "true")
        .create_with_context(ConnectionErrors::new(&clients.cluster.bootstrap_servers))?)
}

/// A requested partition, its watermarks, and where the first page starts in it.
struct PartitionPlan {
    id: i32,
    marks: Watermarks,
    start: i64,
}

fn plan_partitions(consumer: &KafkaConsumer, request: &BrowseRequest) -> Result<Vec<PartitionPlan>> {
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
fn read_until_done(consumer: &KafkaConsumer, mut pending: HashMap<i32, ReadWindow>) -> Result<Vec<Message>> {
    let mut messages = Vec::new();
    let deadline = Instant::now() + TIMEOUT;

    while !pending.is_empty() && Instant::now() < deadline {
        match consumer.poll(Duration::from_millis(200)) {
            None => {}
            Some(Err(KafkaError::PartitionEOF(partition))) => {
                pending.remove(&partition);
            }
            Some(Err(e)) => return Err(explain(consumer, e).into()),
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

fn to_message<M: rdkafka::Message>(m: &M) -> Message {
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

/// Copies messages to `target_topic`, keeping their keys, values and headers as raw bytes.
/// The originals are never touched: a Kafka log is append-only, so KUI only adds copies,
/// appended as new messages stamped "now" like any other.
///
/// Every message is read before any is written, so a missing one fails the whole copy
/// instead of leaving it half done. They are sent one at a time to keep their order.
pub async fn copy(clients: Arc<KafkaClients>, request: &CopyRequest) -> Result<Vec<Delivered>> {
    ensure_writable(&request.target_topic)?;
    if request.messages.is_empty() {
        return Err(Error::msg("No messages to copy"));
    }
    let topic = request.topic.clone();
    let refs: Vec<(i32, i64)> = request.messages.iter().map(|m| (m.partition, m.offset)).collect();
    let reader = clients.clone();
    let originals: Vec<OwnedMessage> = run_blocking(move || {
        let consumer = browsing_consumer(&reader)?;
        refs.into_iter().map(|(partition, offset)| fetch_one(&consumer, &topic, partition, offset)).collect()
    })
    .await?;

    let mut delivered = Vec::with_capacity(originals.len());
    for original in &originals {
        let delivery = clients
            .producer
            .send(copy_record(original, &request.target_topic, request.target_partition), TIMEOUT)
            .await
            .map_err(|(e, _)| Error::from(e))?;
        delivered.push(Delivered { partition: delivery.partition, offset: delivery.offset });
    }
    Ok(delivered)
}

fn copy_record<'a>(
    original: &'a OwnedMessage,
    target_topic: &'a str,
    target_partition: Option<i32>,
) -> FutureRecord<'a, [u8], [u8]> {
    let mut record: FutureRecord<'_, [u8], [u8]> = FutureRecord::to(target_topic);
    if let Some(key) = original.key() {
        record = record.key(key);
    }
    if let Some(value) = original.payload() {
        record = record.payload(value);
    }
    if let Some(headers) = original.headers() {
        record = record.headers(headers.clone());
    }
    if let Some(partition) = target_partition {
        record = record.partition(partition);
    }
    record
}

/// Reads exactly one message, or fails if it was deleted or compacted away.
fn fetch_one(consumer: &KafkaConsumer, topic: &str, partition: i32, offset: i64) -> Result<OwnedMessage> {
    let mut assignment = TopicPartitionList::new();
    assignment.add_partition_offset(topic, partition, Offset::Offset(offset))?;
    consumer.assign(&assignment)?;

    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline {
        match consumer.poll(Duration::from_millis(200)) {
            None => {}
            Some(Ok(m)) if m.offset() == offset && m.partition() == partition => return Ok(m.detach()),
            // Landed somewhere else: the offset is gone (retention, compaction, deletion).
            Some(Ok(_)) | Some(Err(KafkaError::PartitionEOF(_))) => break,
            Some(Err(e)) => return Err(explain(consumer, e).into()),
        }
    }
    Err(Error::msg(format!("Message at partition {partition}, offset {offset} no longer exists")))
}
