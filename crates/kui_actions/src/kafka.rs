//! The Kafka side of a run: the Action's consumer, the `MessageSource` the
//! runner reads it through, and reading back one message to send on its own.

use std::time::Duration;

use rdkafka::consumer::{self, Consumer};
use rdkafka::error::KafkaError;
use rdkafka::message::{BorrowedMessage, Headers, Timestamp};
use rdkafka::{Message, Offset, TopicPartitionList};

use kui_kafka::connection::explain;
use kui_kafka::{ClusterConfig, KafkaConsumer, TIMEOUT, fetch_one, new_consumer_with};

use crate::model::{Source, StartFrom};
use crate::record::{Record, TimestampType};
use crate::run::{CommitMode, MessageSource, NextOffsets};
use crate::{Error, Result};

/// A consumer in the Action's group, subscribed to its topic. Blocking.
pub fn subscribe(cluster: &ClusterConfig, source: &Source) -> Result<KafkaConsumer> {
    let consumer = new_consumer_with(cluster, source.group_id.trim(), |cfg| {
        cfg.set("client.id", "kui-action").set("auto.offset.reset", auto_offset_reset(source.start_from));
    })?;
    let metadata = consumer.fetch_metadata(Some(&source.topic), TIMEOUT).map_err(|e| explain(&consumer, e))?;
    let exists = metadata.topics().iter().any(|t| t.error().is_none() && !t.partitions().is_empty());
    if !exists {
        return Err(Error::msg(format!("Topic \"{}\" doesn't exist on this cluster", source.topic)));
    }
    consumer.subscribe(&[&source.topic])?;
    Ok(consumer)
}

/// Reads one message by position, outside the Action's group: nothing is
/// joined or committed, so a running group's progress is untouched. Blocking.
pub fn fetch(cluster: &ClusterConfig, topic: &str, partition: i32, offset: i64) -> Result<Record> {
    let consumer = new_consumer_with(cluster, "kui-action-send", |cfg| {
        cfg.set("client.id", "kui-action").set("enable.partition.eof", "true");
    })?;
    Ok(fetch_one(&consumer, topic, partition, offset, record)?)
}

fn auto_offset_reset(start: StartFrom) -> &'static str {
    match start {
        StartFrom::Latest => "latest",
        StartFrom::Earliest => "earliest",
    }
}

impl MessageSource for KafkaConsumer {
    fn poll(&self, timeout: Duration) -> Option<Result<Record>> {
        match KafkaConsumer::poll(self, timeout)? {
            Ok(message) => Some(Ok(record(&message))),
            Err(KafkaError::PartitionEOF(_)) => None,
            Err(e) => Some(Err(explain(self, e).into())),
        }
    }

    fn set_paused(&self, paused: bool) -> Result<()> {
        let assignment = self.assignment()?;
        if paused {
            self.pause(&assignment)?
        } else {
            self.resume(&assignment)?
        }
        Ok(())
    }

    fn commit(&self, offsets: &NextOffsets, mode: CommitMode) -> Result<()> {
        let mut list = TopicPartitionList::new();
        for ((topic, partition), next) in offsets {
            list.add_partition_offset(topic, *partition, Offset::Offset(*next))?;
        }
        let mode = match mode {
            CommitMode::Async => consumer::CommitMode::Async,
            CommitMode::Sync => consumer::CommitMode::Sync,
        };
        Ok(Consumer::commit(self, &list, mode)?)
    }
}

fn record(m: &BorrowedMessage<'_>) -> Record {
    let (timestamp, timestamp_type) = match m.timestamp() {
        Timestamp::CreateTime(t) => (Some(t), TimestampType::CreateTime),
        Timestamp::LogAppendTime(t) => (Some(t), TimestampType::LogAppendTime),
        Timestamp::NotAvailable => (None, TimestampType::NotAvailable),
    };
    let headers = m
        .headers()
        .map(|h| h.iter().map(|h| (h.key.to_string(), h.value.map(<[u8]>::to_vec))).collect())
        .unwrap_or_default();
    Record {
        topic: m.topic().to_string(),
        partition: m.partition(),
        offset: m.offset(),
        timestamp,
        timestamp_type,
        key: m.key().map(<[u8]>::to_vec),
        value: m.payload().map(<[u8]>::to_vec),
        headers,
    }
}
