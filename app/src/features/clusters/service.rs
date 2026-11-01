use std::time::Duration;

use rdkafka::consumer::Consumer;

use crate::error::Result;
use kui_kafka::ClusterConfig;
use kui_kafka::connection::explain;
use kui_kafka::new_consumer;

/// Connects with a throwaway client and fetches metadata.
/// Returns the number of brokers that answered.
pub fn test_connection(cluster: &ClusterConfig) -> Result<usize> {
    let consumer = new_consumer(cluster, "kui-connection-test")?;
    let metadata = consumer.fetch_metadata(None, Duration::from_secs(8)).map_err(|e| explain(&consumer, e))?;
    Ok(metadata.brokers().len())
}
