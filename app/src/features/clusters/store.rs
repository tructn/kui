use std::collections::HashSet;
use std::path::PathBuf;

use super::secrets::{SecretStore, Secrets};
use crate::error::{Error, Result};
use crate::json_file;
use crate::kafka::ClusterConfig;

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
    pub fn save(&mut self, mut cluster: ClusterConfig) -> Result<ClusterConfig> {
        if cluster.id.is_empty() {
            cluster.id = uuid::Uuid::new_v4().to_string();
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
