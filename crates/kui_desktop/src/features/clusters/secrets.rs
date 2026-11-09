//! Cluster secrets (SASL password, OAuth client secret, TLS key password, and
//! secret-bearing advanced properties such as `ssl.key.pem`) are
//! kept in the OS credential store rather than in `clusters.json`, so other
//! programs running as the user, backups and synced folders don't see them.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use kui_kafka::{ClusterConfig, is_secret_property};

/// Holds one secret blob per cluster id.
pub trait SecretStore: Send + Sync {
    fn get(&self, id: &str) -> Result<Option<String>>;
    fn set(&self, id: &str, value: &str) -> Result<()>;
    fn delete(&self, id: &str) -> Result<()>;
}

/// The OS credential store: macOS Keychain, Windows Credential Manager, or
/// the Secret Service (GNOME Keyring, KWallet) on Linux.
pub struct Keychain;

const SERVICE: &str = "io.github.tructn.kui";

fn entry(id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, id).map_err(keychain_error)
}

fn keychain_error(e: keyring::Error) -> Error {
    Error::msg(format!("Could not use the system keychain: {e}"))
}

impl SecretStore for Keychain {
    fn get(&self, id: &str) -> Result<Option<String>> {
        match entry(id)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keychain_error(e)),
        }
    }

    fn set(&self, id: &str, value: &str) -> Result<()> {
        entry(id)?.set_password(value).map_err(keychain_error)
    }

    fn delete(&self, id: &str) -> Result<()> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keychain_error(e)),
        }
    }
}

/// The secret fields of a cluster, moved in and out as one keychain item.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Secrets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sasl_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    oauth_client_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ssl_key_password: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    properties: BTreeMap<String, String>,
}

impl std::fmt::Debug for Secrets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Secrets").field("empty", &self.is_empty()).finish_non_exhaustive()
    }
}

impl Secrets {
    /// Moves the secrets out of `cluster`, leaving those fields empty.
    pub fn take(cluster: &mut ClusterConfig) -> Self {
        let nonblank = |v: Option<String>| v.filter(|s| !s.is_empty());
        let (secret, plain): (BTreeMap<_, _>, BTreeMap<_, _>) = std::mem::take(&mut cluster.properties)
            .into_iter()
            .partition(|(k, v)| is_secret_property(k) && !v.is_empty());
        cluster.properties = plain;
        Self {
            properties: secret,
            sasl_password: nonblank(cluster.sasl_password.take()),
            oauth_client_secret: nonblank(cluster.oauth_client_secret.take()),
            ssl_key_password: nonblank(cluster.ssl_key_password.take()),
        }
    }

    /// Puts the secrets back into `cluster`.
    pub fn restore(self, cluster: &mut ClusterConfig) {
        cluster.sasl_password = self.sasl_password;
        cluster.oauth_client_secret = self.oauth_client_secret;
        cluster.ssl_key_password = self.ssl_key_password;
        cluster.properties.extend(self.properties);
    }

    pub fn is_empty(&self) -> bool {
        self.sasl_password.is_none()
            && self.oauth_client_secret.is_none()
            && self.ssl_key_password.is_none()
            && self.properties.is_empty()
    }

    /// Reads a cluster's secrets; none stored reads as empty.
    pub fn load(store: &dyn SecretStore, id: &str) -> Result<Self> {
        match store.get(id)? {
            // Not `?`: serde errors can quote the secret they failed on.
            Some(json) => {
                serde_json::from_str(&json).map_err(|_| Error::msg("The keychain item for this cluster is unreadable."))
            }
            None => Ok(Self::default()),
        }
    }

    /// Writes a cluster's secrets, or removes the item when there are none.
    pub fn save(&self, store: &dyn SecretStore, id: &str) -> Result<()> {
        if self.is_empty() { store.delete(id) } else { store.set(id, &serde_json::to_string(self)?) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_has_no_secrets() {
        let mut c: ClusterConfig = serde_json::from_value(
            serde_json::json!({ "name": "c", "bootstrapServers": "h:9092", "saslPassword": "pw-secret" }),
        )
        .unwrap();
        c.properties.insert("sasl.oauthbearer.config".into(), "cfg-secret".into());
        let secrets = Secrets::take(&mut c);
        let text = format!("{secrets:?} {secrets:#?}");
        assert!(!text.contains("pw-secret") && !text.contains("cfg-secret"), "{text}");
    }

    #[test]
    fn oauthbearer_config_and_alias_move_to_secrets() {
        let mut c: ClusterConfig =
            serde_json::from_value(serde_json::json!({ "name": "c", "bootstrapServers": "h:9092" })).unwrap();
        c.properties.insert("sasl.oauthbearer.config".into(), "a=b".into());
        c.properties.insert("sasl.oauthbearer.client.credentials.client.secret".into(), "s".into());
        let secrets = Secrets::take(&mut c);
        assert!(c.properties.is_empty());
        secrets.restore(&mut c);
        assert_eq!(c.properties.len(), 2);
    }
}

#[cfg(test)]
pub mod testing {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use super::*;

    /// An in-memory keychain. Clones share the same contents, so a test can
    /// keep one to inspect what the store wrote.
    #[derive(Clone, Default)]
    pub struct MemoryKeychain(pub Arc<Mutex<HashMap<String, String>>>);

    impl SecretStore for MemoryKeychain {
        fn get(&self, id: &str) -> Result<Option<String>> {
            Ok(self.0.lock().unwrap().get(id).cloned())
        }
        fn set(&self, id: &str, value: &str) -> Result<()> {
            self.0.lock().unwrap().insert(id.into(), value.into());
            Ok(())
        }
        fn delete(&self, id: &str) -> Result<()> {
            self.0.lock().unwrap().remove(id);
            Ok(())
        }
    }

    /// A keychain that is never available, like a Linux box with no Secret Service.
    pub struct NoKeychain;

    impl SecretStore for NoKeychain {
        fn get(&self, _: &str) -> Result<Option<String>> {
            Err(Error::msg("no keychain"))
        }
        fn set(&self, _: &str, _: &str) -> Result<()> {
            Err(Error::msg("no keychain"))
        }
        fn delete(&self, _: &str) -> Result<()> {
            Err(Error::msg("no keychain"))
        }
    }
}
