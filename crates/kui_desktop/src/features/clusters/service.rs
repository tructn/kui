use std::time::Duration;

use rdkafka::consumer::Consumer;

use crate::error::Result;
use kui_kafka::ClusterConfig;
use kui_kafka::connection::explain;
use kui_kafka::{check_properties, new_consumer};

/// Connects with a throwaway client and fetches metadata.
/// Returns the number of brokers that answered.
pub fn test_connection(cluster: &ClusterConfig) -> Result<usize> {
    check_properties(&cluster.properties)?;
    let consumer = new_consumer(cluster, "kui-connection-test")?;
    let metadata = consumer.fetch_metadata(None, Duration::from_secs(8)).map_err(|e| explain(&consumer, e))?;
    Ok(metadata.brokers().len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connection_rejects_denied_properties_before_connecting() {
        let cluster: ClusterConfig = serde_json::from_value(serde_json::json!({
            "name": "c",
            "bootstrapServers": "127.0.0.1:1",
            "properties": { "plugin.library.paths": "/tmp/x.so" },
        }))
        .unwrap();
        let err = test_connection(&cluster).unwrap_err().to_string();
        assert!(err.contains("not allowed"), "{err}");

        let alias: ClusterConfig = serde_json::from_value(serde_json::json!({
            "name": "c",
            "bootstrapServers": "127.0.0.1:1",
            "properties": { "metadata.broker.list": "evil:9092" },
        }))
        .unwrap();
        let err = test_connection(&alias).unwrap_err().to_string();
        assert!(err.contains("not allowed"), "{err}");
    }

    #[test]
    fn test_connection_errors_for_bad_properties_omit_the_value() {
        let cluster: ClusterConfig = serde_json::from_value(serde_json::json!({
            "name": "c",
            "bootstrapServers": "127.0.0.1:1",
            "properties": { "sasl.passwrd": "SENTINEL-hunter2" },
        }))
        .unwrap();
        let err = test_connection(&cluster).unwrap_err().to_string();
        assert!(err.contains("sasl.passwrd") && !err.contains("SENTINEL"), "{err}");
    }
}
