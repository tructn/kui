use std::time::{Duration, Instant};

use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::error::KafkaError;
use rdkafka::metadata::{Metadata, MetadataTopic};
use rdkafka::types::RDKafkaErrorCode;

use super::{KafkaClients, TIMEOUT};
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
pub fn fetch_metadata(clients: &KafkaClients, topic: Option<&str>) -> Result<Metadata> {
    let deadline = Instant::now() + 2 * TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match clients.metadata.fetch_metadata(topic, remaining.min(TIMEOUT)) {
            Ok(md) => return Ok(md),
            Err(e) if is_unreachable(&e) => {
                if remaining <= RETRY_PAUSE {
                    return Err(unreachable(&clients.cluster.bootstrap_servers, &e));
                }
                std::thread::sleep(RETRY_PAUSE);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

const RETRY_PAUSE: Duration = Duration::from_millis(500);

/// Errors meaning no broker answered, as opposed to one answering with an error.
fn is_unreachable(e: &KafkaError) -> bool {
    use RDKafkaErrorCode::*;
    matches!(
        e.rdkafka_error_code(),
        Some(
            BrokerTransportFailure | AllBrokersDown | Resolve | OperationTimedOut | RequestTimedOut | NetworkException
        )
    )
}

fn unreachable(bootstrap_servers: &str, e: &KafkaError) -> Error {
    let cause = e.rdkafka_error_code().map_or_else(|| e.to_string(), |code| code.to_string());
    Error::msg(format!(
        "Can't reach the cluster at {bootstrap_servers} ({cause}). \
         If it is behind a VPN, check that the VPN is connected, then retry."
    ))
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

    #[test]
    fn only_connection_failures_count_as_unreachable() {
        assert!(is_unreachable(&KafkaError::MetadataFetch(RDKafkaErrorCode::AllBrokersDown)));
        assert!(is_unreachable(&KafkaError::MetadataFetch(RDKafkaErrorCode::OperationTimedOut)));
        assert!(!is_unreachable(&KafkaError::MetadataFetch(RDKafkaErrorCode::SaslAuthenticationFailed)));
        assert!(!is_unreachable(&KafkaError::MetadataFetch(RDKafkaErrorCode::TopicAuthorizationFailed)));
    }

    #[test]
    fn unreachable_names_the_servers_and_the_vpn() {
        let e = unreachable("kafka.internal:9092", &KafkaError::MetadataFetch(RDKafkaErrorCode::AllBrokersDown));
        let msg = e.to_string();
        assert!(msg.starts_with("Can't reach the cluster at kafka.internal:9092 ("), "{msg}");
        assert!(msg.contains("VPN"), "{msg}");
    }
}
