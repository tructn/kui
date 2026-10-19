use std::time::{Duration, Instant};

use rdkafka::consumer::Consumer;
use rdkafka::metadata::{Metadata, MetadataTopic};
use rdkafka::types::RDKafkaErrorCode;

use super::connection::{explain, is_unreachable, rejection};
use super::{KafkaClients, KafkaConsumer, TIMEOUT};
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

/// Metadata for `topic`, or every topic when `None`, retried while the
/// connection comes up. The first request on a fresh client races its
/// bootstrap connection; behind a VPN (slow DNS, TLS handshake, a tunnel still
/// coming up) it can fail or time out although the cluster answers a moment later.
/// A broker rejecting the credentials or the TLS handshake is not retried.
pub fn fetch_metadata(clients: &KafkaClients, topic: Option<&str>) -> Result<Metadata> {
    let consumer = &clients.metadata;
    let deadline = Instant::now() + CONNECT_BUDGET;
    let time_left = || deadline.saturating_duration_since(Instant::now());
    loop {
        match consumer.fetch_metadata(topic, time_left().min(TIMEOUT)) {
            Ok(md) => return Ok(md),
            // Measured after the failed attempt, which may have used up the budget.
            Err(e) if is_unreachable(&e) && time_left() > RETRY_PAUSE + MIN_ATTEMPT => {
                if let Some(rejected) = rejection(consumer) {
                    return Err(rejected);
                }
                std::thread::sleep(RETRY_PAUSE);
            }
            Err(e) => return Err(explain(consumer, e)),
        }
    }
}

/// How long `fetch_metadata` keeps trying to reach the cluster: two full attempts.
const CONNECT_BUDGET: Duration = TIMEOUT.saturating_mul(2);
const RETRY_PAUSE: Duration = Duration::from_millis(500);
/// The shortest attempt worth retrying with; below it the request can't
/// even finish a TCP and TLS handshake to a distant broker.
const MIN_ATTEMPT: Duration = Duration::from_millis(500);

/// Partition ids of one topic, sorted ascending.
pub fn partition_ids(consumer: &KafkaConsumer, topic: &str) -> Result<Vec<i32>> {
    let md = consumer.fetch_metadata(Some(topic), TIMEOUT).map_err(|e| explain(consumer, e))?;
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
