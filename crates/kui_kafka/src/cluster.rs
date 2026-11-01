use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A saved connection to a Kafka cluster. Lives here rather than in the
/// `clusters` feature because every client is built from it.
///
/// Kafka splits security into two layers, and the fields follow that split:
/// - TLS (`SSL`, `SASL_SSL`) encrypts the connection. Its `ssl_*` fields are
///   certificates: a CA to trust the brokers, and optionally a client
///   certificate + key, which is how plain `SSL` authenticates (mutual TLS).
/// - SASL (`SASL_PLAINTEXT`, `SASL_SSL`) authenticates. What it needs depends
///   on the mechanism: PLAIN and SCRAM take a username + password, OAUTHBEARER
///   takes OAuth client credentials that are swapped for a token.
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

    /// PLAIN | SCRAM-SHA-256 | SCRAM-SHA-512 | OAUTHBEARER
    #[serde(default)]
    pub sasl_mechanism: Option<String>,
    /// PLAIN and SCRAM only.
    #[serde(default)]
    pub sasl_username: Option<String>,
    #[serde(default)]
    pub sasl_password: Option<String>,

    /// OAUTHBEARER only: OAuth 2.0 client-credentials grant against this URL.
    #[serde(default)]
    pub oauth_token_endpoint: Option<String>,
    #[serde(default)]
    pub oauth_client_id: Option<String>,
    #[serde(default)]
    pub oauth_client_secret: Option<String>,
    /// Space-separated scopes; optional for most identity providers.
    #[serde(default)]
    pub oauth_scope: Option<String>,

    /// PEM file with the CA certificate(s) that signed the brokers'
    /// certificates. Empty means the system's trusted CAs.
    #[serde(default)]
    pub ssl_ca_location: Option<String>,
    /// PEM client certificate, for brokers that require mutual TLS.
    #[serde(default)]
    pub ssl_certificate_location: Option<String>,
    /// PEM private key that belongs to the client certificate.
    #[serde(default)]
    pub ssl_key_location: Option<String>,
    /// Only needed when the private key is encrypted.
    #[serde(default)]
    pub ssl_key_password: Option<String>,
    /// Check that the broker's certificate matches its hostname.
    #[serde(default = "default_true")]
    pub ssl_verify_hostname: bool,

    /// Extra librdkafka properties; they override every setting above.
    #[serde(default)]
    pub properties: BTreeMap<String, String>,
}

impl ClusterConfig {
    pub fn uses_tls(&self) -> bool {
        matches!(self.security_protocol.as_str(), "SSL" | "SASL_SSL")
    }

    pub fn uses_sasl(&self) -> bool {
        self.security_protocol.starts_with("SASL")
    }
}

fn default_protocol() -> String {
    "PLAINTEXT".into()
}

fn default_true() -> bool {
    true
}
