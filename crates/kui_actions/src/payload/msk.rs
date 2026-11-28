use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Map, Value, json};

use super::Origin;
use crate::record::{Record, TimestampType};

/// The event an MSK event source mapping delivers, holding this one record.
pub fn msk_event(record: &Record, origin: &Origin<'_>) -> Value {
    let mut entry = Map::new();
    entry.insert("topic".into(), json!(record.topic));
    entry.insert("partition".into(), json!(record.partition));
    entry.insert("offset".into(), json!(record.offset));
    if let Some(timestamp) = record.timestamp {
        entry.insert("timestamp".into(), json!(timestamp));
    }
    let timestamp_type = match record.timestamp_type {
        TimestampType::CreateTime => "CREATE_TIME",
        TimestampType::LogAppendTime => "LOG_APPEND_TIME",
        TimestampType::NotAvailable => "NO_TIMESTAMP_TYPE",
    };
    entry.insert("timestampType".into(), json!(timestamp_type));
    // AWS leaves out a null key or value rather than sending null.
    if let Some(key) = &record.key {
        entry.insert("key".into(), json!(STANDARD.encode(key)));
    }
    if let Some(value) = &record.value {
        entry.insert("value".into(), json!(STANDARD.encode(value)));
    }
    // Each header is a one-entry object holding its bytes as signed numbers, the way
    // AWS's Java-based poller writes them (the .NET event type reads `sbyte[]`).
    let headers: Vec<Value> = record
        .headers
        .iter()
        .map(|(name, value)| {
            let signed: Vec<i8> = value.iter().flatten().map(|b| i8::from_ne_bytes([*b])).collect();
            json!({ name: signed })
        })
        .collect();
    entry.insert("headers".into(), Value::Array(headers));

    json!({
        "eventSource": "aws:kafka",
        // Clearly fake: a real-looking ARN could be mistaken for a deployed cluster.
        "eventSourceArn": format!("arn:aws:kafka:local:000000000000:cluster/kui/{}", origin.cluster_id),
        "bootstrapServers": origin.bootstrap_servers,
        "records": { format!("{}-{}", record.topic, record.partition): [entry] },
    })
}

#[cfg(test)]
mod tests {
    use super::super::fixtures::{ORIGIN, record};
    use super::*;

    #[test]
    fn msk_event_matches_the_aws_shape() {
        let event = msk_event(&record(Some(b"{\"a\":1}")), &ORIGIN);
        let expected = json!({
            "eventSource": "aws:kafka",
            "eventSourceArn": "arn:aws:kafka:local:000000000000:cluster/kui/local",
            "bootstrapServers": "localhost:9092",
            "records": {
                "demo.orders-2": [{
                    "topic": "demo.orders",
                    "partition": 2,
                    "offset": 15,
                    "timestamp": 1_764_316_800_000_i64,
                    "timestampType": "CREATE_TIME",
                    "key": "b3JkZXItMQ==",
                    "value": "eyJhIjoxfQ==",
                    "headers": [{ "traceId": [104, 105] }, { "empty": [] }],
                }]
            }
        });
        assert_eq!(event, expected);
    }

    #[test]
    fn msk_event_omits_null_key_value_and_missing_timestamp() {
        let mut r = record(None);
        r.key = None;
        r.timestamp = None;
        r.timestamp_type = TimestampType::NotAvailable;
        let entry = &msk_event(&r, &ORIGIN)["records"]["demo.orders-2"][0];
        for field in ["key", "value", "timestamp"] {
            assert!(entry.get(field).is_none(), "{field}");
        }
        assert_eq!(entry["timestampType"], "NO_TIMESTAMP_TYPE");
    }

    /// The example .NET function's test deserializes this same file with AWS's
    /// `KafkaEvent`, so the two together check KUI against the real event type.
    #[test]
    fn matches_the_example_projects_event_fixture() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../../examples/order-lambda/events/msk-event.json")).unwrap();
        let value = br#"{"orderId":"order-3","customer":"cust-3","total":39.99,"status":"NEW"}"#;
        let record = Record {
            topic: "demo.orders".into(),
            partition: 0,
            offset: 3,
            timestamp: Some(1_764_316_800_000),
            timestamp_type: TimestampType::CreateTime,
            key: Some(b"order-3".to_vec()),
            value: Some(value.to_vec()),
            headers: vec![("traceId".into(), Some(b"abc".to_vec()))],
        };
        assert_eq!(msk_event(&record, &ORIGIN), fixture);
    }

    #[test]
    fn header_bytes_are_signed_as_aws_sends_them() {
        let mut r = record(None);
        r.headers = vec![("name".into(), Some("é".as_bytes().to_vec()))];
        let entry = &msk_event(&r, &ORIGIN)["records"]["demo.orders-2"][0];
        assert_eq!(entry["headers"], json!([{ "name": [-61, -87] }]));
    }
}
