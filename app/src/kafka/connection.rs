//! Turns librdkafka's connection failures into messages a user can act on.
//! A failed request only says no broker answered; why (a wrong host, a
//! rejected password, SSL against a PLAINTEXT listener) is reported to the
//! client's context, which keeps it for the error message.

use std::sync::Mutex;
use std::time::Duration;

use rdkafka::ClientContext;
use rdkafka::consumer::{BaseConsumer, Consumer, ConsumerContext};
use rdkafka::error::KafkaError;
use rdkafka::types::RDKafkaErrorCode;

use crate::error::Error;

/// Every consumer KUI creates, so the offset and metadata helpers take any of them.
pub type KafkaConsumer = BaseConsumer<ConnectionErrors>;

/// Keeps the last error librdkafka reported for a client, and where it was
/// connecting to. A consumer records errors only while it is polled.
/// librdkafka reports a repeated error only now and then, so the last one
/// stays until replaced.
pub struct ConnectionErrors {
    bootstrap_servers: String,
    last: Mutex<Option<ConnectionError>>,
}

#[derive(Debug, Clone)]
struct ConnectionError {
    code: Option<RDKafkaErrorCode>,
    reason: String,
}

impl ConnectionErrors {
    pub fn new(bootstrap_servers: &str) -> Self {
        Self { bootstrap_servers: bootstrap_servers.to_string(), last: Mutex::new(None) }
    }
}

impl ClientContext for ConnectionErrors {
    fn error(&self, error: KafkaError, reason: &str) {
        let error = ConnectionError { code: error.rdkafka_error_code(), reason: reason.to_string() };
        *self.last.lock().unwrap() = Some(error);
    }
}

impl ConsumerContext for ConnectionErrors {}

/// Errors meaning no broker answered, as opposed to one answering with an error.
pub fn is_unreachable(e: &KafkaError) -> bool {
    use RDKafkaErrorCode::*;
    matches!(
        e.rdkafka_error_code(),
        Some(
            BrokerTransportFailure | AllBrokersDown | Resolve | OperationTimedOut | RequestTimedOut | NetworkException
        )
    )
}

/// The error for a failed request on `consumer`, explained with what
/// librdkafka reported about the connection.
pub fn explain(consumer: &KafkaConsumer, e: KafkaError) -> Error {
    if !is_unreachable(&e) {
        return e.into();
    }
    let servers = &consumer.context().bootstrap_servers;
    let cause = last_error(consumer);
    if let Some(rejected) = cause.as_ref().and_then(|c| rejected(servers, c)) {
        return rejected;
    }
    let cause = cause.map_or_else(|| short_cause(&e).to_string(), |c| tidy(&c.reason));
    Error::msg(unreachable(Some(servers), &cause))
}

/// Why the cluster turned `consumer`'s connection down, if it did. Retrying
/// won't fix that, unlike a network that is still coming up.
pub fn rejection(consumer: &KafkaConsumer) -> Option<Error> {
    rejected(&consumer.context().bootstrap_servers, &last_error(consumer)?)
}

/// The message for a Kafka error from a client that doesn't keep its
/// connection errors (admin, producer).
pub fn describe(e: &KafkaError) -> String {
    if is_unreachable(e) { unreachable(None, short_cause(e)) } else { e.to_string() }
}

/// Serves the consumer's queued events, so its context records any connection
/// error, and returns the latest one. With a zero timeout `poll` also returns
/// `None` after an event it handled internally, ahead of queued errors, so it
/// gets a short timeout to work through those. Only called once a request has
/// failed, so any message it polls is not missed.
fn last_error(consumer: &KafkaConsumer) -> Option<ConnectionError> {
    while consumer.poll(Duration::from_millis(10)).is_some() {}
    consumer.context().last.lock().unwrap().clone()
}

/// The broker answered but turned the connection down: wrong credentials or
/// SASL mechanism, or a TLS mismatch such as SSL against a PLAINTEXT listener.
/// librdkafka reports the latter as a transport failure, so only its reason
/// tells them apart.
fn rejected(bootstrap_servers: &str, e: &ConnectionError) -> Option<Error> {
    let reason = tidy(&e.reason);
    let msg = if e.code == Some(RDKafkaErrorCode::Authentication) {
        format!(
            "The cluster at {bootstrap_servers} rejected the sign-in ({reason}). \
             Check the username, password and SASL mechanism."
        )
    } else if e.code == Some(RDKafkaErrorCode::SSL) || e.reason.contains("SSL handshake failed") {
        format!(
            "Can't open a secure connection to {bootstrap_servers} ({reason}). \
             Check the security protocol and SSL settings."
        )
    } else {
        return None;
    };
    Some(Error::msg(msg))
}

fn unreachable(bootstrap_servers: Option<&str>, cause: &str) -> String {
    let at = bootstrap_servers.map(|s| format!(" at {s}")).unwrap_or_default();
    format!(
        "Can't reach the cluster{at} ({cause}). If it is behind a VPN, check that the VPN is connected, then retry."
    )
}

/// What an unreachable error code means, when librdkafka gave no reason.
fn short_cause(e: &KafkaError) -> &'static str {
    use RDKafkaErrorCode::*;
    match e.rdkafka_error_code() {
        Some(AllBrokersDown) => "no broker is available",
        Some(Resolve) => "host name not found",
        Some(OperationTimedOut | RequestTimedOut) => "the request timed out",
        Some(NetworkException) => "network error",
        _ => "the connection failed",
    }
}

/// A librdkafka error reason without the broker it came from, the
/// connection state and address-family tags, which mean nothing to a user:
/// `localhost:9092/bootstrap: Connect to ipv4#127.0.0.1:9092 failed (after 0ms in state CONNECT)`.
fn tidy(reason: &str) -> String {
    let reason = match reason.split_once(": ") {
        Some((broker, rest)) if !broker.contains(' ') => rest,
        _ => reason,
    };
    let reason = reason.split(" (after ").next().unwrap_or(reason).trim();
    reason.replace("ipv4#", "").replace("ipv6#", "")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reported(code: RDKafkaErrorCode, reason: &str) -> ConnectionError {
        ConnectionError { code: Some(code), reason: reason.to_string() }
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
        let msg = unreachable(Some("kafka.internal:9092"), "the connection failed");
        assert!(msg.starts_with("Can't reach the cluster at kafka.internal:9092 (the connection failed)"), "{msg}");
        assert!(msg.contains("VPN"), "{msg}");
    }

    #[test]
    fn other_clients_get_a_plain_message_too() {
        let msg = describe(&KafkaError::MetadataFetch(RDKafkaErrorCode::BrokerTransportFailure));
        assert!(msg.starts_with("Can't reach the cluster (the connection failed)"), "{msg}");
        assert!(!msg.contains("BrokerTransportFailure"), "{msg}");

        let msg = describe(&KafkaError::MetadataFetch(RDKafkaErrorCode::TopicAuthorizationFailed));
        assert!(msg.contains("TopicAuthorizationFailed"), "{msg}");
    }

    #[test]
    fn reasons_drop_the_broker_and_connection_state() {
        assert_eq!(
            tidy(
                "kafka.internal:9092/bootstrap: Failed to resolve 'kafka.internal:9092': nodename nor servname provided, or not known (after 280ms in state CONNECT)"
            ),
            "Failed to resolve 'kafka.internal:9092': nodename nor servname provided, or not known"
        );
        assert_eq!(
            tidy(
                "localhost:9099/bootstrap: Connect to ipv4#127.0.0.1:9099 failed: Connection refused (after 0ms in state CONNECT)"
            ),
            "Connect to 127.0.0.1:9099 failed: Connection refused"
        );
        assert_eq!(tidy("Connection refused"), "Connection refused");
    }

    #[test]
    fn rejected_connections_are_not_blamed_on_the_network() {
        let auth = reported(
            RDKafkaErrorCode::Authentication,
            "sasl_plaintext://localhost:9094/bootstrap: SASL authentication error: Authentication failed: Invalid username or password (after 316ms in state AUTH_REQ)",
        );
        let msg = rejected("localhost:9094", &auth).unwrap().to_string();
        assert!(
            msg.contains(
                "rejected the sign-in (SASL authentication error: Authentication failed: Invalid username or password)"
            ),
            "{msg}"
        );
        assert!(!msg.contains("VPN"), "{msg}");

        let tls = reported(
            RDKafkaErrorCode::BrokerTransportFailure,
            "ssl://localhost:9092/bootstrap: SSL handshake failed: Disconnected: SSL connection closed by peer: connecting to a PLAINTEXT broker listener? (after 4ms in state SSL_HANDSHAKE)",
        );
        let msg = rejected("localhost:9092", &tls).unwrap().to_string();
        assert!(msg.contains("secure connection") && msg.contains("PLAINTEXT broker listener?"), "{msg}");

        let refused = reported(
            RDKafkaErrorCode::BrokerTransportFailure,
            "localhost:9099/bootstrap: Connect to ipv4#127.0.0.1:9099 failed: Connection refused (after 0ms in state CONNECT)",
        );
        assert!(rejected("localhost:9099", &refused).is_none());
    }
}
