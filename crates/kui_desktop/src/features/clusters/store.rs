use std::collections::HashSet;
use std::path::PathBuf;

use super::secrets::{SecretStore, Secrets};
use crate::error::{Error, Result};
use crate::json_file;
use kui_kafka::{ClusterConfig, check_properties};

/// Cluster list persisted as a JSON file in the app config directory. The
/// secret fields are kept in the OS keychain instead (see `secrets.rs`).
///
/// If the keychain can't be used (say, Linux without a Secret Service), a
/// cluster's secrets stay in the file as before, readable by the owner only,
/// so KUI keeps working rather than losing the password.
pub struct ClusterStore {
    path: PathBuf,
    /// Held in memory with their secrets filled in.
    clusters: Vec<ClusterConfig>,
    keychain: Box<dyn SecretStore>,
    /// Ids whose secrets couldn't go to the keychain and stay in the file.
    secrets_in_file: HashSet<String>,
}

impl ClusterStore {
    pub fn load(path: PathBuf, keychain: Box<dyn SecretStore>) -> Result<Self> {
        let clusters: Vec<ClusterConfig> = json_file::load(&path)?;
        let mut store = Self { path, clusters, keychain, secrets_in_file: HashSet::new() };

        let mut migrated = false;
        for cluster in &mut store.clusters {
            let in_file = Secrets::take(cluster);
            if in_file.is_empty() {
                // A locked or missing keychain leaves the cluster without its
                // password; connecting then reports the sign-in failure.
                if let Ok(secrets) = Secrets::load(&*store.keychain, &cluster.id) {
                    secrets.restore(cluster);
                }
            } else {
                // Saved by an older version, or the keychain was unavailable.
                // Move them over now if we can.
                if in_file.save(&*store.keychain, &cluster.id).is_ok() {
                    migrated = true;
                } else {
                    store.secrets_in_file.insert(cluster.id.clone());
                }
                in_file.restore(cluster);
            }
        }
        if migrated {
            store.persist()?;
        }
        Ok(store)
    }

    pub fn list(&self) -> Vec<ClusterConfig> {
        self.clusters.clone()
    }

    pub fn get(&self, id: &str) -> Result<ClusterConfig> {
        self.clusters.iter().find(|c| c.id == id).cloned().ok_or_else(|| Error::msg(format!("Unknown cluster: {id}")))
    }

    /// Inserts a new cluster (assigning an id) or replaces an existing one.
    /// An id from the caller must name a cluster that already exists: ids are
    /// only ever issued here, and double as the keychain account name.
    pub fn save(&mut self, mut cluster: ClusterConfig) -> Result<ClusterConfig> {
        check_properties(&cluster.properties)?;
        if cluster.id.is_empty() {
            cluster.id = uuid::Uuid::new_v4().to_string();
        } else if !is_plain_id(&cluster.id) || !self.clusters.iter().any(|c| c.id == cluster.id) {
            return Err(Error::msg("Unknown cluster id."));
        }
        let mut stripped = cluster.clone();
        if Secrets::take(&mut stripped).save(&*self.keychain, &cluster.id).is_ok() {
            self.secrets_in_file.remove(&cluster.id);
        } else {
            self.secrets_in_file.insert(cluster.id.clone());
        }
        match self.clusters.iter_mut().find(|c| c.id == cluster.id) {
            Some(existing) => *existing = cluster.clone(),
            None => self.clusters.push(cluster.clone()),
        }
        self.persist()?;
        Ok(cluster)
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        self.clusters.retain(|c| c.id != id);
        self.secrets_in_file.remove(id);
        self.persist()?;
        // Best effort: a keychain error shouldn't stop the cluster from going.
        self.keychain.delete(id).ok();
        Ok(())
    }

    /// Writes the file with secrets left out, except for clusters whose
    /// secrets couldn't be put in the keychain.
    fn persist(&self) -> Result<()> {
        let on_disk: Vec<ClusterConfig> = self
            .clusters
            .iter()
            .cloned()
            .map(|mut c| {
                if !self.secrets_in_file.contains(&c.id) {
                    Secrets::take(&mut c);
                }
                c
            })
            .collect();
        json_file::save(&self.path, &on_disk)
    }
}

fn is_plain_id(id: &str) -> bool {
    id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::super::secrets::testing::{MemoryKeychain, NoKeychain};
    use super::*;

    fn cluster(name: &str) -> ClusterConfig {
        serde_json::from_value(serde_json::json!({
            "name": name,
            "bootstrapServers": "localhost:9092"
        }))
        .unwrap()
    }

    fn with_password(name: &str) -> ClusterConfig {
        let mut c = cluster(name);
        c.security_protocol = "SASL_SSL".into();
        c.sasl_username = Some("alice".into());
        c.sasl_password = Some("s3cret".into());
        c
    }

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!("kui-test-{}.json", uuid::Uuid::new_v4()))
    }

    fn file_text(path: &PathBuf) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn save_assigns_id_and_persists_across_loads() {
        let path = temp_path();
        let keychain = MemoryKeychain::default();
        let mut store = ClusterStore::load(path.clone(), Box::new(keychain.clone())).unwrap();

        let saved = store.save(cluster("local")).unwrap();
        assert!(!saved.id.is_empty());

        let reloaded = ClusterStore::load(path.clone(), Box::new(keychain.clone())).unwrap();
        assert_eq!(reloaded.get(&saved.id).unwrap().name, "local");

        store.delete(&saved.id).unwrap();
        assert!(ClusterStore::load(path.clone(), Box::new(keychain)).unwrap().list().is_empty());
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn passwords_go_to_the_keychain_not_the_file() {
        let path = temp_path();
        let keychain = MemoryKeychain::default();
        let mut store = ClusterStore::load(path.clone(), Box::new(keychain.clone())).unwrap();

        let saved = store.save(with_password("prod")).unwrap();
        assert_eq!(saved.sasl_password.as_deref(), Some("s3cret"));
        assert!(!file_text(&path).contains("s3cret"));
        assert!(keychain.0.lock().unwrap()[&saved.id].contains("s3cret"));

        // A fresh load puts the password back from the keychain.
        let reloaded = ClusterStore::load(path.clone(), Box::new(keychain.clone())).unwrap();
        assert_eq!(reloaded.get(&saved.id).unwrap().sasl_password.as_deref(), Some("s3cret"));

        // Deleting the cluster removes its keychain item.
        store.delete(&saved.id).unwrap();
        assert!(keychain.0.lock().unwrap().is_empty());
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn clearing_a_password_removes_the_keychain_item() {
        let path = temp_path();
        let keychain = MemoryKeychain::default();
        let mut store = ClusterStore::load(path.clone(), Box::new(keychain.clone())).unwrap();

        let mut saved = store.save(with_password("prod")).unwrap();
        saved.security_protocol = "PLAINTEXT".into();
        saved.sasl_password = None;
        store.save(saved).unwrap();
        assert!(keychain.0.lock().unwrap().is_empty());
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn passwords_saved_by_older_versions_move_to_the_keychain() {
        let path = temp_path();
        let mut old = with_password("prod");
        old.id = "old-id".into();
        json_file::save(&path, &vec![old]).unwrap();

        let keychain = MemoryKeychain::default();
        let store = ClusterStore::load(path.clone(), Box::new(keychain.clone())).unwrap();
        assert_eq!(store.get("old-id").unwrap().sasl_password.as_deref(), Some("s3cret"));
        assert!(!file_text(&path).contains("s3cret"));
        assert!(keychain.0.lock().unwrap()["old-id"].contains("s3cret"));
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn secret_properties_go_to_the_keychain_not_the_file() {
        let path = temp_path();
        let keychain = MemoryKeychain::default();
        let mut store = ClusterStore::load(path.clone(), Box::new(keychain.clone())).unwrap();

        let mut c = cluster("prod");
        c.properties.insert("sasl.password".into(), "pr0p-secret".into());
        c.properties.insert("ssl.key.pem".into(), "PEM-secret".into());
        c.properties.insert("ssl.ca.location".into(), "/ca.pem".into());
        let saved = store.save(c).unwrap();

        let text = file_text(&path);
        assert!(!text.contains("pr0p-secret") && !text.contains("PEM-secret"));
        assert!(text.contains("/ca.pem"));
        assert!(keychain.0.lock().unwrap()[&saved.id].contains("pr0p-secret"));

        let reloaded = ClusterStore::load(path.clone(), Box::new(keychain)).unwrap();
        let back = reloaded.get(&saved.id).unwrap();
        assert_eq!(back.properties["sasl.password"], "pr0p-secret");
        assert_eq!(back.properties["ssl.key.pem"], "PEM-secret");
        assert_eq!(back.properties["ssl.ca.location"], "/ca.pem");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn secret_properties_in_an_old_file_move_to_the_keychain() {
        let path = temp_path();
        let mut old = cluster("prod");
        old.id = "old-id".into();
        old.properties.insert("ssl.keystore.password".into(), "ks-secret".into());
        json_file::save(&path, &vec![old]).unwrap();

        let keychain = MemoryKeychain::default();
        let store = ClusterStore::load(path.clone(), Box::new(keychain.clone())).unwrap();
        assert_eq!(store.get("old-id").unwrap().properties["ssl.keystore.password"], "ks-secret");
        assert!(!file_text(&path).contains("ks-secret"));
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn without_a_keychain_secret_properties_stay_in_the_file() {
        let path = temp_path();
        let mut store = ClusterStore::load(path.clone(), Box::new(NoKeychain)).unwrap();
        let mut c = cluster("prod");
        c.properties.insert("sasl.password".into(), "pr0p-secret".into());
        let saved = store.save(c).unwrap();
        assert!(file_text(&path).contains("pr0p-secret"));
        let reloaded = ClusterStore::load(path.clone(), Box::new(NoKeychain)).unwrap();
        assert_eq!(reloaded.get(&saved.id).unwrap().properties["sasl.password"], "pr0p-secret");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn save_rejects_denied_properties() {
        let path = temp_path();
        let mut store = ClusterStore::load(path.clone(), Box::new(MemoryKeychain::default())).unwrap();
        let mut c = cluster("evil");
        c.properties.insert("plugin.library.paths".into(), "/tmp/x.so".into());
        assert!(store.save(c).is_err());
        let mut alias = cluster("evil");
        alias.properties.insert("metadata.broker.list".into(), "evil:9092".into());
        assert!(store.save(alias).is_err());
        assert!(store.list().is_empty());
        assert!(!path.exists());
    }

    #[test]
    fn save_rejects_ids_that_do_not_exist() {
        let path = temp_path();
        let keychain = MemoryKeychain::default();
        let mut store = ClusterStore::load(path.clone(), Box::new(keychain.clone())).unwrap();
        let existing = store.save(cluster("a")).unwrap();

        for id in ["no-such-cluster", "../etc", "x".repeat(65).as_str()] {
            let mut c = with_password("b");
            c.id = id.into();
            assert!(store.save(c).is_err(), "{id}");
        }
        assert_eq!(store.list().len(), 1);
        assert!(keychain.0.lock().unwrap().is_empty());

        let mut update = cluster("a2");
        update.id = existing.id.clone();
        assert_eq!(store.save(update).unwrap().name, "a2");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn without_a_keychain_passwords_stay_in_the_file() {
        let path = temp_path();
        let mut store = ClusterStore::load(path.clone(), Box::new(NoKeychain)).unwrap();

        let saved = store.save(with_password("prod")).unwrap();
        assert!(file_text(&path).contains("s3cret"));

        let reloaded = ClusterStore::load(path.clone(), Box::new(NoKeychain)).unwrap();
        assert_eq!(reloaded.get(&saved.id).unwrap().sasl_password.as_deref(), Some("s3cret"));
        std::fs::remove_file(path).ok();
    }
}
