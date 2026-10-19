use rdkafka::ClientConfig;
use rdkafka::admin::AdminClient;
use rdkafka::client::DefaultClientContext;
use rdkafka::producer::FutureProducer;

use super::ClusterConfig;
use super::connection::{ConnectionErrors, KafkaConsumer};
use crate::error::Result;

/// Long-lived clients for one cluster, cached in `AppState` so we don't
/// re-bootstrap the connection on every UI request.
pub struct KafkaClients {
    pub cluster: ClusterConfig,
    pub admin: AdminClient<DefaultClientContext>,
    /// Used for metadata, offsets and group listing. Never subscribes to topics.
    pub metadata: KafkaConsumer,
    pub producer: FutureProducer,
}

impl KafkaClients {
    pub fn connect(cluster: ClusterConfig) -> Result<Self> {
        let base = client_config(&cluster);
        Ok(Self {
            admin: base.create()?,
            metadata: new_consumer(&cluster, "kui-metadata")?,
            producer: base.clone().set("message.timeout.ms", "10000").create()?,
            cluster,
        })
    }
}

/// Translates a saved cluster into librdkafka settings.
pub fn client_config(cluster: &ClusterConfig) -> ClientConfig {
    let mut cfg = ClientConfig::new();
    cfg.set("bootstrap.servers", &cluster.bootstrap_servers)
        .set("security.protocol", &cluster.security_protocol)
        .set("client.id", "kui")
        .set("socket.timeout.ms", "10000")
        .set("reconnect.backoff.max.ms", "5000")
        .set("log_level", "3");

    if cluster.security_protocol.starts_with("SASL") {
        let sasl = [
            ("sasl.mechanism", &cluster.sasl_mechanism),
            ("sasl.username", &cluster.sasl_username),
            ("sasl.password", &cluster.sasl_password),
        ];
        for (key, value) in sasl {
            if let Some(v) = value.as_deref().filter(|v| !v.trim().is_empty()) {
                cfg.set(key, v);
            }
        }
    }
    // User-supplied properties go last so they can override anything above.
    for (k, v) in &cluster.properties {
        cfg.set(k, v);
    }
    cfg
}

/// A consumer that never auto-commits. Safe for reading data without
/// affecting any real consumer group's progress.
pub fn new_consumer(cluster: &ClusterConfig, group_id: &str) -> Result<KafkaConsumer> {
    Ok(client_config(cluster)
        .set("group.id", group_id)
        .set("enable.auto.commit", "false")
        .create_with_context(ConnectionErrors::new(&cluster.bootstrap_servers))?)
}
