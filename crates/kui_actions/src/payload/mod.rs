//! Turns a Kafka record into the body a Lambda function is invoked with.

mod msk;

pub use msk::msk_event;

use crate::model::PayloadFormat;
use crate::record::Record;

/// Where the record came from, for the MSK event's source fields.
pub struct Origin<'a> {
    pub cluster_id: &'a str,
    pub bootstrap_servers: &'a str,
}

pub fn build(format: PayloadFormat, record: &Record, origin: &Origin<'_>) -> Result<Vec<u8>, String> {
    match format {
        PayloadFormat::Raw => raw(record),
        PayloadFormat::Msk => Ok(msk_event(record, origin).to_string().into_bytes()),
    }
}

/// The Invoke API only accepts JSON, so a non-JSON value is refused here with
/// advice, instead of failing in SAM with a less helpful error.
fn raw(record: &Record) -> Result<Vec<u8>, String> {
    match &record.value {
        None => Ok(b"null".to_vec()),
        Some(value) if serde_json::from_slice::<serde::de::IgnoredAny>(value).is_ok() => Ok(value.clone()),
        Some(_) => Err("The message value isn't JSON, which the Lambda Invoke API requires. \
                        Use the AWS MSK event payload to send any bytes."
            .to_string()),
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
    use super::Origin;
    use crate::record::{Record, TimestampType};

    pub const ORIGIN: Origin<'static> = Origin { cluster_id: "local", bootstrap_servers: "localhost:9092" };

    pub fn record(value: Option<&[u8]>) -> Record {
        Record {
            topic: "demo.orders".into(),
            partition: 2,
            offset: 15,
            timestamp: Some(1_764_316_800_000),
            timestamp_type: TimestampType::CreateTime,
            key: Some(b"order-1".to_vec()),
            value: value.map(<[u8]>::to_vec),
            headers: vec![("traceId".into(), Some(b"hi".to_vec())), ("empty".into(), None)],
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::fixtures::{ORIGIN, record};
    use super::*;

    #[test]
    fn raw_sends_json_values_unchanged() {
        let body = build(PayloadFormat::Raw, &record(Some(br#"{"total": 1.5}"#)), &ORIGIN).unwrap();
        assert_eq!(body, br#"{"total": 1.5}"#);
    }

    #[test]
    fn raw_sends_null_for_tombstones_and_refuses_non_json() {
        assert_eq!(build(PayloadFormat::Raw, &record(None), &ORIGIN).unwrap(), b"null");
        let error = build(PayloadFormat::Raw, &record(Some(b"plain text")), &ORIGIN).unwrap_err();
        assert!(error.contains("MSK event"), "{error}");
    }

    #[test]
    fn msk_payload_accepts_any_bytes() {
        let body = build(PayloadFormat::Msk, &record(Some(&[0xff, 0x00])), &ORIGIN).unwrap();
        let event: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(event["records"]["demo.orders-2"][0]["value"], "/wA=");
    }
}
