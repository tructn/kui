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

    // Only the settings that belong to the chosen protocol and mechanism are
    // passed on, so values left over from an earlier choice can't leak in.
    if cluster.uses_tls() {
        set_some(&mut cfg, "ssl.ca.location", &cluster.ssl_ca_location);
        set_some(&mut cfg, "ssl.certificate.location", &cluster.ssl_certificate_location);
        set_some(&mut cfg, "ssl.key.location", &cluster.ssl_key_location);
        set_some(&mut cfg, "ssl.key.password", &cluster.ssl_key_password);
        if !cluster.ssl_verify_hostname {
            cfg.set("ssl.endpoint.identification.algorithm", "none");
        }
    }
    if cluster.uses_sasl() {
        let mechanism = cluster.sasl_mechanism.as_deref().unwrap_or("PLAIN");
        cfg.set("sasl.mechanism", mechanism);
        if mechanism == "OAUTHBEARER" {
            // librdkafka fetches the token and refreshes it before it expires.
            cfg.set("sasl.oauthbearer.method", "oidc");
            set_some(&mut cfg, "sasl.oauthbearer.token.endpoint.url", &cluster.oauth_token_endpoint);
            set_some(&mut cfg, "sasl.oauthbearer.client.id", &cluster.oauth_client_id);
            set_some(&mut cfg, "sasl.oauthbearer.client.secret", &cluster.oauth_client_secret);
            set_some(&mut cfg, "sasl.oauthbearer.scope", &cluster.oauth_scope);
        } else {
            set_some(&mut cfg, "sasl.username", &cluster.sasl_username);
            set_some(&mut cfg, "sasl.password", &cluster.sasl_password);
        }
    }
    // User-supplied properties go last so they can override anything above.
    for (k, v) in &cluster.properties {
        cfg.set(k, v);
    }
    cfg
}

/// Sets `key` only when the value is present and not blank.
fn set_some(cfg: &mut ClientConfig, key: &str, value: &Option<String>) {
    if let Some(v) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        cfg.set(key, v);
    }
}

/// A consumer that never auto-commits. Safe for reading data without
/// affecting any real consumer group's progress.
pub fn new_consumer(cluster: &ClusterConfig, group_id: &str) -> Result<KafkaConsumer> {
    Ok(client_config(cluster)
        .set("group.id", group_id)
        .set("enable.auto.commit", "false")
        .create_with_context(ConnectionErrors::new(&cluster.bootstrap_servers))?)
}

#[cfg(test)]
mod tests {
    use rdkafka::consumer::BaseConsumer;

    use super::*;

    fn cluster(extra: serde_json::Value) -> ClusterConfig {
        let mut json = serde_json::json!({ "name": "c", "bootstrapServers": "localhost:9092" });
        json.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn scram_sends_username_and_password_only() {
        let cfg = client_config(&cluster(serde_json::json!({
            "securityProtocol": "SASL_SSL",
            "saslMechanism": "SCRAM-SHA-512",
            "saslUsername": "alice",
            "saslPassword": "secret",
            "oauthClientId": "left-over",
        })));
        assert_eq!(cfg.get("sasl.mechanism"), Some("SCRAM-SHA-512"));
        assert_eq!(cfg.get("sasl.username"), Some("alice"));
        assert_eq!(cfg.get("sasl.password"), Some("secret"));
        assert_eq!(cfg.get("sasl.oauthbearer.client.id"), None);
    }

    #[test]
    fn oauthbearer_uses_oidc_client_credentials() {
        let cfg = client_config(&cluster(serde_json::json!({
            "securityProtocol": "SASL_SSL",
            "saslMechanism": "OAUTHBEARER",
            "saslPassword": "left-over",
            "oauthTokenEndpoint": "https://idp.example.com/token",
            "oauthClientId": "kui",
            "oauthClientSecret": "s3cret",
            "oauthScope": "kafka",
        })));
        assert_eq!(cfg.get("sasl.mechanism"), Some("OAUTHBEARER"));
        assert_eq!(cfg.get("sasl.oauthbearer.method"), Some("oidc"));
        assert_eq!(cfg.get("sasl.oauthbearer.token.endpoint.url"), Some("https://idp.example.com/token"));
        assert_eq!(cfg.get("sasl.oauthbearer.client.id"), Some("kui"));
        assert_eq!(cfg.get("sasl.oauthbearer.client.secret"), Some("s3cret"));
        assert_eq!(cfg.get("sasl.oauthbearer.scope"), Some("kafka"));
        assert_eq!(cfg.get("sasl.password"), None);
    }

    #[test]
    fn tls_certificates_apply_only_to_tls_protocols() {
        let certs = serde_json::json!({
            "sslCaLocation": "/certs/ca.pem",
            "sslCertificateLocation": "/certs/client.pem",
            "sslKeyLocation": "/certs/client.key",
            "sslKeyPassword": "pw",
            "sslVerifyHostname": false,
        });
        let mut tls = certs.clone();
        tls["securityProtocol"] = "SSL".into();
        let cfg = client_config(&cluster(tls));
        assert_eq!(cfg.get("ssl.ca.location"), Some("/certs/ca.pem"));
        assert_eq!(cfg.get("ssl.certificate.location"), Some("/certs/client.pem"));
        assert_eq!(cfg.get("ssl.key.location"), Some("/certs/client.key"));
        assert_eq!(cfg.get("ssl.key.password"), Some("pw"));
        assert_eq!(cfg.get("ssl.endpoint.identification.algorithm"), Some("none"));
        assert_eq!(cfg.get("sasl.mechanism"), None);

        let mut plain = certs;
        plain["securityProtocol"] = "SASL_PLAINTEXT".into();
        let cfg = client_config(&cluster(plain));
        assert_eq!(cfg.get("ssl.ca.location"), None);
        assert_eq!(cfg.get("ssl.endpoint.identification.algorithm"), None);
    }

    #[test]
    fn hostname_verification_is_on_by_default() {
        let cfg = client_config(&cluster(serde_json::json!({ "securityProtocol": "SSL" })));
        assert_eq!(cfg.get("ssl.endpoint.identification.algorithm"), None);
    }

    #[test]
    fn advanced_properties_override_form_fields() {
        let cfg = client_config(&cluster(serde_json::json!({
            "securityProtocol": "SASL_SSL",
            "saslMechanism": "PLAIN",
            "properties": { "sasl.mechanism": "SCRAM-SHA-256" },
        })));
        assert_eq!(cfg.get("sasl.mechanism"), Some("SCRAM-SHA-256"));
    }

    /// librdkafka rejects OIDC settings at client creation when it was built
    /// without libcurl, so this guards the `curl-static` feature.
    #[cfg(not(windows))]
    #[test]
    fn librdkafka_accepts_oidc_settings() {
        let cfg = client_config(&cluster(serde_json::json!({
            "securityProtocol": "SASL_SSL",
            "saslMechanism": "OAUTHBEARER",
            "oauthTokenEndpoint": "https://idp.example.com/token",
            "oauthClientId": "kui",
            "oauthClientSecret": "s3cret",
        })));
        cfg.create::<BaseConsumer>().expect("OIDC should be built in");
    }
}
