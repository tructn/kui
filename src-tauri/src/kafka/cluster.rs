use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A saved connection to a Kafka cluster. Lives here rather than in the
/// `clusters` feature because every client is built from it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterConfig {
    /// Empty for a new cluster; the store assigns one on save.
    #[serde(default)]
    pub id: String,
    pub name: String,
    /// Comma-separated `host:port` list.
    pub bootstrap_servers: String,
    /// PLAINTEXT | SSL | SASL_PLAINTEXT | SASL_SSL
    #[serde(default = "default_protocol")]
    pub security_protocol: String,
    /// PLAIN | SCRAM-SHA-256 | SCRAM-SHA-512
    #[serde(default)]
    pub sasl_mechanism: Option<String>,
    #[serde(default)]
    pub sasl_username: Option<String>,
    #[serde(default)]
    pub sasl_password: Option<String>,
    /// Extra librdkafka properties; they override every setting above.
    #[serde(default)]
    pub properties: BTreeMap<String, String>,
    /// Confluent-compatible Schema Registry, e.g. `http://localhost:8081`.
    /// Without it, Avro and registry-framed Protobuf can't be decoded.
    #[serde(default)]
    pub schema_registry_url: Option<String>,
    /// Basic auth for the registry (Confluent Cloud: API key and secret).
    #[serde(default)]
    pub schema_registry_username: Option<String>,
    #[serde(default)]
    pub schema_registry_password: Option<String>,
}

fn default_protocol() -> String {
    "PLAINTEXT".into()
}
