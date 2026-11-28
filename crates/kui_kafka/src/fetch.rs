use std::time::{Duration, Instant};

use rdkafka::consumer::Consumer;
use rdkafka::error::KafkaError;
use rdkafka::message::BorrowedMessage;
use rdkafka::{Message, Offset, TopicPartitionList};

use crate::connection::{KafkaConsumer, explain};
use crate::{Error, Result, TIMEOUT};

/// Reads exactly one message, or fails if it was deleted or compacted away.
/// Assigns the partition directly, so no consumer group is joined or committed.
pub fn fetch_one<T>(
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
            Some(Err(e)) => return Err(explain(consumer, e)),
        }
    }
    Err(Error::msg(format!("Message at partition {partition}, offset {offset} no longer exists")))
}
