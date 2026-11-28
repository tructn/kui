//! Turns a Kafka record into the body a Lambda function is invoked with.

mod msk;

pub use msk::msk_event;

use crate::record::Record;

/// Where the record came from, for the MSK event's source fields.
pub struct Origin<'a> {
    pub cluster_id: &'a str,
    pub bootstrap_servers: &'a str,
}

/// The event AWS Lambda receives from an MSK event source mapping, holding this one record.
pub fn build(record: &Record, origin: &Origin<'_>) -> Vec<u8> {
    msk_event(record, origin).to_string().into_bytes()
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
    fn accepts_any_bytes() {
        let body = build(&record(Some(&[0xff, 0x00])), &ORIGIN);
        let event: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(event["records"]["demo.orders-2"][0]["value"], "/wA=");
    }
}
