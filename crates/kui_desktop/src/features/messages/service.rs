use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rdkafka::consumer::Consumer;
use rdkafka::error::KafkaError;
use rdkafka::message::{BorrowedMessage, Header, OwnedHeaders, OwnedMessage};
use rdkafka::producer::FutureRecord;
use rdkafka::{Message as _, Offset, TopicPartitionList};

use super::codec::{Budget, MAX_HEADERS, Mode, PAGE_BYTE_BUDGET, decode_within, headers_text, shrink};
use super::export::ExportWriter;
use super::headers;
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
use kui_kafka::{KafkaClients, KafkaConsumer, TIMEOUT, client_config, created};

const MAX_PAGE_SIZE: usize = 1000;
/// Export pages hold full payloads (nothing is truncated in a file), so keep them small.
const EXPORT_PAGE_SIZE: usize = 100;

/// Reads one page of messages, continuing from `request.cursor` if given.
///
/// Each partition reads at most one page's worth from its cursor; the reads are
/// merged by time (see `window::merge_page`). Uses a fresh consumer with manual
/// partition assignment and no commits, so browsing never affects a real consumer group.
pub fn browse(clients: &KafkaClients, request: &BrowseRequest) -> Result<BrowsePage> {
    browse_with(&browsing_consumer(clients)?, request, Mode::Page)
}

/// `browse` on an existing browsing consumer, so several pages can share one.
fn browse_with(consumer: &KafkaConsumer, request: &BrowseRequest, mode: Mode) -> Result<BrowsePage> {
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
    let reader = PageReader { consumer, topic: &request.topic, partitions: &partitions, backward, mode };

    let Some(query) = query else {
        let (messages, next) = reader.read(&start, size, None)?;
        return Ok(BrowsePage { messages, total, next, scanned: None });
    };

    // Search: read raw pages and keep the matches until the page is full, the
    // topic ends, or the budget runs out (the UI offers to keep going from `next`).
    let deadline = Instant::now() + SEARCH_TIME_BUDGET;
    let mut matches = Vec::with_capacity(size);
    let mut scanned = 0u64;
    let mut page_bytes = 0usize;
    let limits = ScanLimits { size, deadline, byte_cap: PAGE_BYTE_BUDGET };
    // A file's chunks hold whole payloads, so they stay small.
    let chunk = if mode == Mode::Export { EXPORT_PAGE_SIZE } else { SEARCH_CHUNK };
    let mut cursor = start;
    loop {
        let mut retained = Retained::new();
        let (raw, next) = reader.read(&cursor, chunk, (mode != Mode::Export).then_some(&mut retained))?;
        // The chunk's first message is always matched, so it is never left without its whole payload.
        if let Some(first) = raw.first().map(|m| (m.partition, m.offset))
            && retained.overflow.remove(&first)
        {
            let whole = fetch_one(consumer, &request.topic, first.0, first.1, |m| {
                (m.key().map(<[u8]>::to_vec), m.payload().map(<[u8]>::to_vec))
            })?;
            retained.bytes.insert(first, whole);
        }
        let (consumed, stop) = scan_chunk(
            raw,
            &mut matches,
            &limits,
            &mut page_bytes,
            |m| retained.overflow.contains(&(m.partition, m.offset)),
            |m| matches_full(&query, m, &retained),
        );
        scanned += consumed.len() as u64;
        if stop != ScanStop::Exhausted {
            // Page full or out of time mid-chunk: resume right after the last message looked at.
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

#[derive(Debug, PartialEq)]
enum ScanStop {
    Exhausted,
    PageFull,
    OutOfTime,
    /// The next message's whole payload isn't held (see `Retained`).
    Deferred,
}

struct ScanLimits {
    size: usize,
    deadline: Instant,
    /// Displayed bytes the hits of a whole page may add up to.
    byte_cap: usize,
}

/// Runs `matches` over `raw` in order, collecting hits until the page holds `size` or its
/// hits add up to `byte_cap`. Checks the deadline after every message, since one evaluation
/// can be slow, and stops before a message `defer` flags. At least one message is always
/// looked at so a search can't stall. Returns the `(partition, offset)` of every message looked
/// at; a hit is never dropped, the page just ends and its cursor resumes after them.
fn scan_chunk(
    raw: Vec<Message>,
    found: &mut Vec<Message>,
    limits: &ScanLimits,
    page_bytes: &mut usize,
    defer: impl Fn(&Message) -> bool,
    matches: impl Fn(&Message) -> bool,
) -> (Vec<(i32, i64)>, ScanStop) {
    let mut consumed = Vec::with_capacity(raw.len());
    for message in raw {
        if !consumed.is_empty() && defer(&message) {
            return (consumed, ScanStop::Deferred);
        }
        consumed.push((message.partition, message.offset));
        if matches(&message) {
            *page_bytes += displayed_bytes(&message);
            found.push(message);
            if found.len() == limits.size || *page_bytes >= limits.byte_cap {
                return (consumed, ScanStop::PageFull);
            }
        }
        if Instant::now() >= limits.deadline {
            return (consumed, ScanStop::OutOfTime);
        }
    }
    (consumed, ScanStop::Exhausted)
}

/// Text bytes a message adds to a page (what goes over IPC).
fn displayed_bytes(m: &Message) -> usize {
    let payloads = m.key.iter().chain(m.value.iter()).map(|p| p.text.len()).sum::<usize>();
    payloads + m.headers.iter().map(|h| h.key.len() + h.value.as_ref().map_or(0, String::len)).sum::<usize>()
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
    mode: Mode,
}

/// Most displayed text an export read may hold at once, across all partitions.
const EXPORT_READ_BYTES: usize = 64 * 1024 * 1024;

/// Runs `attempt` with `size`, halving it each time the attempt reports it went over its byte
/// cap (`None`). Size 1 is never refused, so every read takes at least one message per partition.
fn within_bytes<T>(size: usize, mut attempt: impl FnMut(usize) -> Result<Option<T>>) -> Result<T> {
    let mut size = size;
    loop {
        if let Some(done) = attempt(size)? {
            return Ok(done);
        }
        size = (size / 2).max(1);
    }
}

impl PageReader<'_> {
    /// Displayed text one `read` may hold.
    fn budget(&self) -> usize {
        if self.mode == Mode::Export { usize::MAX } else { PAGE_BYTE_BUDGET }
    }

    /// Up to `size` messages from `cursor` (a position for every partition), and
    /// the cursor after them, or `None` when nothing is left.
    ///
    /// An export holds whole payloads from every partition at once, so it retries with a smaller
    /// page when a read goes over `EXPORT_READ_BYTES`; the page is then shorter, never skipped.
    fn read(
        &self,
        cursor: &Cursor,
        size: usize,
        mut retained: Option<&mut Retained>,
    ) -> Result<(Vec<Message>, Option<Cursor>)> {
        within_bytes(size, |size| self.read_once(cursor, size, retained.as_deref_mut()))
    }

    /// `None` when an export read went over its byte cap (never at size 1).
    fn read_once(
        &self,
        cursor: &Cursor,
        size: usize,
        retained: Option<&mut Retained>,
    ) -> Result<Option<(Vec<Message>, Option<Cursor>)>> {
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
            let cap = if self.mode == Mode::Export && size > 1 { EXPORT_READ_BYTES } else { usize::MAX };
            let Some(read) = read_until_done(
                self.consumer,
                windows.clone(),
                &mut Budget::new(self.budget()),
                self.mode,
                retained,
                cap,
            )?
            else {
                return Ok(None);
            };
            for message in read {
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
        Ok(Some((messages, more.then_some(next))))
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
                let page_request = BrowseRequest { page_size: left.min(EXPORT_PAGE_SIZE), cursor, ..browse.clone() };
                let page = browse_with(&consumer, &page_request, Mode::Export)?;
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
                writer.write(&fetch_one(&consumer, topic, partition, offset, |m| {
                    to_message(m, &mut Budget::unlimited(), Mode::Export)
                })?)?;
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
    let mut budget = Budget::new(PAGE_BYTE_BUDGET);
    let mut last_flush = Instant::now();
    while !cancel.is_cancelled() {
        match consumer.poll(Duration::from_millis(100)) {
            None | Some(Err(KafkaError::PartitionEOF(_))) => {}
            Some(Err(e)) => return Err(explain(&consumer, e).into()),
            Some(Ok(m)) => {
                // Filter on the whole payload; only a kept message is cut to the batch budget.
                let mut message = to_message(&m, &mut budget, Mode::Tail);
                if query.as_ref().is_none_or(|q| q.matches(&message)) {
                    for payload in message.key.iter_mut().chain(message.value.iter_mut()) {
                        shrink(payload, &mut budget);
                    }
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
            budget = Budget::new(PAGE_BYTE_BUDGET);
        }
    }
    Ok(())
}

fn browsing_consumer(clients: &KafkaClients) -> Result<KafkaConsumer> {
    browsing_consumer_for(&clients.cluster)
}

fn browsing_consumer_for(cluster: &kui_kafka::ClusterConfig) -> Result<KafkaConsumer> {
    Ok(created(
        client_config(cluster)
            .set("group.id", format!("kui-browser-{}", uuid::Uuid::new_v4()))
            .set("enable.auto.commit", "false")
            .set("enable.partition.eof", "true")
            .create_with_context(ConnectionErrors::new(&cluster.bootstrap_servers)),
    )?)
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
fn read_until_done(
    consumer: &KafkaConsumer,
    mut pending: HashMap<i32, ReadWindow>,
    budget: &mut Budget,
    mode: Mode,
    mut retained: Option<&mut Retained>,
    byte_cap: usize,
) -> Result<Option<Vec<Message>>> {
    let mut messages = Vec::new();
    let mut held = 0usize;
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
                    let message = to_message(&m, budget, mode);
                    if let Some(retained) = retained.as_deref_mut() {
                        retained.keep_if_cut(&message, &m);
                    }
                    held += displayed_bytes(&message);
                    messages.push(message);
                    if held > byte_cap {
                        return Ok(None);
                    }
                }
                // Compacted/transactional topics can skip offsets, so compare with `>=`.
                if m.offset() + 1 >= window.end {
                    pending.remove(&m.partition());
                }
            }
        }
    }
    Ok(Some(messages))
}

/// Raw key/value bytes of messages whose displayed text was cut, so a search can run on the
/// whole payload. Dropped after every chunk. Holds at most `RETAINED_LIMIT`: a cut message that
/// doesn't fit is listed in `overflow` instead, and the chunk ends before it (`scan_chunk`'s
/// `defer`), so the next chunk starts there. Matching never uses a cut prefix.
type RawKeyValue = (Option<Vec<u8>>, Option<Vec<u8>>);

struct Retained {
    left: usize,
    bytes: HashMap<(i32, i64), RawKeyValue>,
    overflow: HashSet<(i32, i64)>,
}

/// Raw bytes held per search chunk. A single message larger than this is still matched whole
/// (fetched alone, bounded by the broker's message.max.bytes).
const RETAINED_LIMIT: usize = 64 * 1024 * 1024;

impl Retained {
    fn new() -> Self {
        Self { left: RETAINED_LIMIT, bytes: HashMap::new(), overflow: HashSet::new() }
    }

    fn keep_if_cut(&mut self, message: &Message, raw: &BorrowedMessage<'_>) {
        if !message.key.iter().chain(message.value.iter()).any(|p| p.truncated) {
            return;
        }
        let at = (message.partition, message.offset);
        let size = raw.key().map_or(0, <[u8]>::len) + raw.payload().map_or(0, <[u8]>::len);
        if size <= self.left {
            self.left -= size;
            self.bytes.insert(at, (raw.key().map(<[u8]>::to_vec), raw.payload().map(<[u8]>::to_vec)));
        } else {
            self.overflow.insert(at);
        }
    }
}

/// Evaluates `query` on the message's whole payloads, not the cut text the UI gets.
fn matches_full(query: &query::Query, message: &Message, retained: &Retained) -> bool {
    let Some((key, value)) = retained.bytes.get(&(message.partition, message.offset)) else {
        return query.matches(message);
    };
    let whole = |bytes: &Option<Vec<u8>>| bytes.as_deref().map(|b| decode_within(b, &mut Budget::unlimited()));
    query.matches(&Message {
        partition: message.partition,
        offset: message.offset,
        timestamp: message.timestamp,
        key: whole(key),
        value: whole(value),
        headers: message.headers.iter().map(|h| MessageHeader { key: h.key.clone(), value: h.value.clone() }).collect(),
    })
}

fn to_message(m: &BorrowedMessage<'_>, budget: &mut Budget, mode: Mode) -> Message {
    let mut whole = Budget::unlimited();
    let payload_budget = if mode == Mode::Page { &mut *budget } else { &mut whole };
    let key = m.key().map(|k| decode_within(k, payload_budget));
    let value = m.payload().map(|v| decode_within(v, payload_budget));
    let limit = if mode == Mode::Export { usize::MAX } else { MAX_HEADERS };
    let headers = m
        .headers()
        .map(|hs| {
            let (raw, total) = headers::read(hs, limit);
            headers_text(raw, total, mode, budget)
        })
        .unwrap_or_default();

    Message { partition: m.partition(), offset: m.offset(), timestamp: m.timestamp().to_millis(), key, value, headers }
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
        refs.into_iter()
            .map(|(partition, offset)| fetch_one(&consumer, &topic, partition, offset, |m| m.detach()))
            .collect()
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
fn fetch_one<T>(
    consumer: &KafkaConsumer,
    topic: &str,
    partition: i32,
    offset: i64,
    convert: impl FnOnce(&BorrowedMessage<'_>) -> T,
) -> Result<T> {
    let mut assignment = TopicPartitionList::new();
    assignment.add_partition_offset(topic, partition, Offset::Offset(offset))?;
    consumer.assign(&assignment)?;

    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline {
        match consumer.poll(Duration::from_millis(200)) {
            None => {}
            Some(Ok(m)) if m.offset() == offset && m.partition() == partition => return Ok(convert(&m)),
            // Landed somewhere else: the offset is gone (retention, compaction, deletion).
            Some(Ok(_)) | Some(Err(KafkaError::PartitionEOF(_))) => break,
            Some(Err(e)) => return Err(explain(consumer, e).into()),
        }
    }
    Err(Error::msg(format!("Message at partition {partition}, offset {offset} no longer exists")))
}

#[cfg(test)]
mod tests {
    use super::super::model::Payload;
    use super::*;

    fn far() -> Instant {
        Instant::now() + Duration::from_secs(60)
    }

    fn limits(size: usize, deadline: Instant) -> ScanLimits {
        ScanLimits { size, deadline, byte_cap: usize::MAX }
    }

    fn message_with_value(offset: i64, len: usize) -> Message {
        let mut m = message(offset);
        m.value = Some(Payload { text: "x".repeat(len), encoding: "utf8", size: len, truncated: false });
        m
    }

    #[test]
    fn a_read_over_its_byte_cap_is_retried_smaller_until_it_fits_and_size_one_always_goes_through() {
        let mut tried = Vec::new();
        let got = within_bytes(100, |size| {
            tried.push(size);
            Ok((size <= 12).then_some(size))
        })
        .unwrap();
        assert_eq!((got, tried), (12, vec![100, 50, 25, 12]));
        let mut tried = Vec::new();
        let got = within_bytes(8, |size| {
            tried.push(size);
            Ok((size == 1).then_some(size))
        })
        .unwrap();
        assert_eq!((got, tried), (1, vec![8, 4, 2, 1]));
    }

    #[test]
    fn a_bad_property_never_echoes_its_value_when_creating_the_browsing_consumer() {
        let cluster: kui_kafka::ClusterConfig = serde_json::from_value(serde_json::json!({
            "name": "c", "bootstrapServers": "localhost:9092",
            "properties": { "session.timeout.ms": "hunter2-not-a-number" }
        }))
        .unwrap();
        let err = browsing_consumer_for(&cluster).err().expect("a bad property is rejected").to_string();
        assert!(!err.contains("hunter2"), "{err}");
        assert!(err.contains("session.timeout.ms"), "{err}");
    }

    #[test]
    fn a_chunk_ends_before_a_message_whose_whole_payload_is_not_held() {
        let raw: Vec<Message> = (0..5).map(message).collect();
        let (consumed, stop) =
            scan_chunk(raw, &mut Vec::new(), &limits(10, far()), &mut 0, |m| m.offset == 3, |_| false);
        assert_eq!((consumed.len(), stop), (3, ScanStop::Deferred));
    }

    #[test]
    fn a_deferred_first_message_is_still_scanned_so_the_search_cannot_stall() {
        let raw: Vec<Message> = (0..5).map(message).collect();
        let (consumed, stop) =
            scan_chunk(raw, &mut Vec::new(), &limits(10, far()), &mut 0, |m| m.offset == 0, |_| false);
        assert_eq!((consumed[0], consumed.len(), stop), ((0, 0), 5, ScanStop::Exhausted));
    }

    #[test]
    fn headers_count_toward_a_hits_displayed_bytes() {
        let mut m = message_with_value(0, 100);
        m.headers = vec![MessageHeader { key: "k".repeat(10), value: Some("v".repeat(40)) }];
        assert_eq!(displayed_bytes(&m), 150);
        let limits = ScanLimits { size: 1000, deadline: far(), byte_cap: 120 };
        let (consumed, stop) = scan_chunk(vec![m, message(1)], &mut Vec::new(), &limits, &mut 0, |_| false, |_| true);
        assert_eq!((consumed.len(), stop), (1, ScanStop::PageFull));
    }

    #[test]
    fn a_page_ends_at_its_byte_cap_keeping_every_hit() {
        let raw: Vec<Message> = (0..10).map(|i| message_with_value(i, 100)).collect();
        let mut found = Vec::new();
        let limits = ScanLimits { size: 1000, deadline: far(), byte_cap: 250 };
        let mut page_bytes = 0;
        let (consumed, stop) = scan_chunk(raw, &mut found, &limits, &mut page_bytes, |_| false, |_| true);
        assert_eq!((consumed.len(), found.len(), stop), (3, 3, ScanStop::PageFull));
        assert_eq!(page_bytes, 300);
    }

    #[test]
    fn the_byte_cap_carries_over_between_chunks() {
        let limits = ScanLimits { size: 1000, deadline: far(), byte_cap: 250 };
        let mut page_bytes = 200;
        let raw = vec![message_with_value(0, 100), message_with_value(1, 100)];
        let (consumed, stop) = scan_chunk(raw, &mut Vec::new(), &limits, &mut page_bytes, |_| false, |_| true);
        assert_eq!((consumed.len(), stop), (1, ScanStop::PageFull));
    }

    fn message(offset: i64) -> Message {
        Message { partition: 0, offset, timestamp: None, key: None, value: None, headers: Vec::new() }
    }

    #[test]
    fn search_matches_the_whole_payload_not_the_cut_text() {
        let q = query::optional(Some("value.status = 'ok'")).unwrap().unwrap();
        let body = format!("{{\"pad\":\"{}\",\"status\":\"ok\"}}", "x".repeat(5000));
        let mut shown = decode_within(body.as_bytes(), &mut Budget::new(0));
        assert!(shown.truncated);
        shown.size = body.len();
        let mut m = message(7);
        m.value = Some(shown);
        assert!(!q.matches(&m), "the cut text alone must not match");

        let mut retained = Retained::new();
        assert!(!matches_full(&q, &m, &retained));
        retained.bytes.insert((0, 7), (None, Some(body.into_bytes())));
        assert!(matches_full(&q, &m, &retained));
        let not = query::optional(Some("value.status != 'ok'")).unwrap().unwrap();
        assert!(!matches_full(&not, &m, &retained));
    }

    #[test]
    fn search_deadline_is_checked_per_message_not_per_chunk() {
        let raw: Vec<Message> = (0..SEARCH_CHUNK as i64).map(message).collect();
        let mut found = Vec::new();
        let deadline = Instant::now() + Duration::from_millis(50);
        let slow = |_: &Message| {
            std::thread::sleep(Duration::from_millis(20));
            false
        };
        let (consumed, stop) = scan_chunk(raw, &mut found, &limits(10, deadline), &mut 0, |_| false, slow);
        assert_eq!(stop, ScanStop::OutOfTime);
        assert!(consumed.len() < 10, "scanned {} of a 500-message chunk", consumed.len());
        assert_eq!(consumed[0], (0, 0));
    }

    #[test]
    fn an_expired_deadline_still_looks_at_one_message() {
        let raw: Vec<Message> = (0..5).map(message).collect();
        let (consumed, stop) =
            scan_chunk(raw, &mut Vec::new(), &limits(10, Instant::now()), &mut 0, |_| false, |_| false);
        assert_eq!((consumed.len(), stop), (1, ScanStop::OutOfTime));
    }

    #[test]
    fn a_full_page_stops_at_the_last_hit() {
        let raw: Vec<Message> = (0..5).map(message).collect();
        let mut found = Vec::new();
        let (consumed, stop) = scan_chunk(raw, &mut found, &limits(2, far()), &mut 0, |_| false, |m| m.offset % 2 == 0);
        assert_eq!((consumed.len(), found.len(), stop), (3, 2, ScanStop::PageFull));
    }
}
