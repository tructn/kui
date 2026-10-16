use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::metadata::MetadataTopic;
use rdkafka::types::RDKafkaErrorCode;

use super::TIMEOUT;
use crate::error::{Error, Result};

/// Topics the platform runs on, which KUI shows read-only and never deletes:
/// Kafka's own (`__consumer_offsets`, `__transaction_state`) and, by
/// convention, those of the tools around it: ksqlDB (`_confluent-ksql-*`),
/// Kafka Connect (`_connect-configs`, …) and Schema Registry (`_schemas`).
/// Deleting one of these breaks the tool that owns it.
pub fn is_internal(topic: &str) -> bool {
    topic.starts_with('_')
}

/// Refuses writes (produce, copy, generate) to an internal topic.
pub fn ensure_writable(topic: &str) -> Result<()> {
    if is_internal(topic) {
        return Err(Error::msg(format!(
            "{topic} is an internal topic, used by Kafka or a tool around it; KUI does not write to it"
        )));
    }
    Ok(())
}

/// Kafka's own bookkeeping topics (double underscore). Nothing consumes them
/// as data, unlike e.g. ksqlDB's internal repartition topics.
pub fn is_broker_internal(topic: &str) -> bool {
    topic.starts_with("__")
}

/// Partition ids of one topic, sorted ascending.
pub fn partition_ids(consumer: &BaseConsumer, topic: &str) -> Result<Vec<i32>> {
    let md = consumer.fetch_metadata(Some(topic), TIMEOUT)?;
    let t = single_topic(md.topics(), topic)?;
    let mut ids: Vec<i32> = t.partitions().iter().map(|p| p.id()).collect();
    ids.sort();
    Ok(ids)
}

/// Picks the requested topic out of a metadata response, surfacing broker errors.
pub fn single_topic<'a>(topics: &'a [MetadataTopic], name: &str) -> Result<&'a MetadataTopic> {
    let t = topics.iter().find(|t| t.name() == name).ok_or_else(|| Error::msg(format!("Topic not found: {name}")))?;
    match t.error() {
        Some(code) => Err(Error::msg(format!("{name}: {}", RDKafkaErrorCode::from(code)))),
        None => Ok(t),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_topics_are_internal() {
        for topic in ["__consumer_offsets", "_schemas", "_connect-configs", "_confluent-ksql-kui__command_topic"] {
            assert!(is_internal(topic), "{topic}");
        }
        for topic in ["orders", "demo.orders", "kui_ksql_processing_log", "my_topic"] {
            assert!(!is_internal(topic), "{topic}");
        }
        assert!(is_broker_internal("__consumer_offsets") && !is_broker_internal("_connect-configs"));
        assert!(ensure_writable("_connect-configs").is_err() && ensure_writable("orders").is_ok());
    }
}
