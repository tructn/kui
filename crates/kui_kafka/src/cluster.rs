use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

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
#[derive(Clone, Serialize, Deserialize)]
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

    /// Extra librdkafka properties; they override the settings above, except the
    /// ones `check_properties` refuses. Secret-bearing keys go to the keychain.
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

/// Why `key` may not be set through `properties`, if it may not. librdkafka
/// can load native code (`plugin.*`, `interceptors`, `ssl.engine.*`) or run a
/// command (`*.cmd`) from these, and the rest are owned by the app: they are
/// first-class fields or keep browsing from committing offsets.
pub(crate) fn denied_property(key: &str) -> Option<&'static str> {
    let key = key.trim().to_ascii_lowercase();
    if key.starts_with("plugin.")
        || key == "interceptors"
        || key.starts_with("ssl.engine.")
        || key.starts_with("sasl.kerberos.")
        || key.ends_with(".cmd")
    {
        Some("it can load code or run a command")
    } else if matches!(
        key.as_str(),
        "bootstrap.servers"
            | "metadata.broker.list"
            | "enable.auto.commit"
            | "auto.commit.enable"
            | "group.id"
            | "security.protocol"
    ) {
        Some("KUI controls it; use the cluster's own fields")
    } else {
        None
    }
}

/// Rejects properties that must not reach librdkafka. Names the key, never the value.
pub fn check_properties(properties: &BTreeMap<String, String>) -> Result<()> {
    for key in properties.keys() {
        if let Some(why) = denied_property(key) {
            return Err(Error::msg(format!("The property \"{key}\" is not allowed: {why}.")));
        }
    }
    Ok(())
}

/// Properties whose value is a secret, so they belong in the keychain.
pub fn is_secret_property(key: &str) -> bool {
    matches!(
        key.trim().to_ascii_lowercase().as_str(),
        "sasl.password"
            | "ssl.key.password"
            | "ssl.keystore.password"
            | "ssl.key.pem"
            | "sasl.oauthbearer.client.secret"
            | "sasl.oauthbearer.client.credentials.client.secret"
            | "sasl.oauthbearer.config"
            | "sasl.oauthbearer.assertion.private.key.pem"
            | "sasl.oauthbearer.assertion.private.key.passphrase"
    )
}

/// Hand-written so a stray `{:?}` can't print secrets: only whether each is set,
/// and the property names without their values.
impl std::fmt::Debug for ClusterConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let set = |v: &Option<String>| if v.is_some() { "<set>" } else { "<none>" };
        f.debug_struct("ClusterConfig")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("security_protocol", &self.security_protocol)
            .field("sasl_mechanism", &self.sasl_mechanism)
            .field("sasl_password", &set(&self.sasl_password))
            .field("oauth_client_secret", &set(&self.oauth_client_secret))
            .field("ssl_key_password", &set(&self.ssl_key_password))
            .field("property_keys", &self.properties.keys().collect::<Vec<_>>())
            .finish_non_exhaustive()
    }
}

fn default_protocol() -> String {
    "PLAINTEXT".into()
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn props(keys: &[&str]) -> BTreeMap<String, String> {
        keys.iter().map(|k| (k.to_string(), "x".to_string())).collect()
    }

    #[test]
    fn dangerous_or_app_owned_properties_are_rejected() {
        for key in [
            "plugin.library.paths",
            "Plugin.Library.Paths",
            "interceptors",
            "ssl.engine.location",
            "sasl.kerberos.kinit.cmd",
            "sasl.kerberos.service.name",
            "anything.cmd",
            "bootstrap.servers",
            "enable.auto.commit",
            "group.id",
            "security.protocol",
            "metadata.broker.list",
            "Auto.Commit.Enable",
            " group.id",
        ] {
            let err = check_properties(&props(&[key])).unwrap_err().to_string();
            assert!(err.contains(key), "{key}: {err}");
        }
    }

    #[test]
    fn legitimate_tls_sasl_and_oauth_properties_pass() {
        check_properties(&props(&[
            "ssl.ca.location",
            "ssl.ca.pem",
            "ssl.certificate.location",
            "ssl.key.password",
            "ssl.keystore.location",
            "ssl.endpoint.identification.algorithm",
            "ssl.cipher.suites",
            "sasl.mechanism",
            "sasl.username",
            "sasl.password",
            "sasl.oauthbearer.token.endpoint.url",
            "sasl.oauthbearer.client.secret",
            "sasl.oauthbearer.scope",
            "socket.timeout.ms",
            "client.id",
        ]))
        .unwrap();
    }

    #[test]
    fn debug_output_has_no_secrets() {
        let c: ClusterConfig = serde_json::from_value(serde_json::json!({
            "name": "c",
            "bootstrapServers": "h:9092",
            "saslPassword": "pw-secret",
            "oauthClientSecret": "oauth-secret",
            "sslKeyPassword": "key-secret",
            "properties": { "ssl.key.pem": "pem-secret" },
        }))
        .unwrap();
        let text = format!("{c:?} {c:#?}");
        for secret in ["pw-secret", "oauth-secret", "key-secret", "pem-secret"] {
            assert!(!text.contains(secret), "{secret} leaked");
        }
    }

    #[test]
    fn secret_property_keys_are_recognised() {
        assert!(is_secret_property("sasl.password"));
        assert!(is_secret_property("SSL.KEY.PEM"));
        assert!(is_secret_property("sasl.oauthbearer.client.secret"));
        assert!(is_secret_property("sasl.oauthbearer.client.credentials.client.secret"));
        assert!(is_secret_property("sasl.oauthbearer.config"));
        assert!(!is_secret_property("sasl.username"));
        assert!(!is_secret_property("ssl.ca.location"));
    }
}
