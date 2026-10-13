use std::path::PathBuf;

use crate::error::{Error, Result};
use crate::json_file;
use crate::kafka::ClusterConfig;

/// Cluster list persisted as a JSON file in the app config directory.
pub struct ClusterStore {
    path: PathBuf,
    clusters: Vec<ClusterConfig>,
}

impl ClusterStore {
    pub fn load(path: PathBuf) -> Result<Self> {
        let clusters = json_file::load(&path)?;
        Ok(Self { path, clusters })
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
        match self.clusters.iter_mut().find(|c| c.id == cluster.id) {
            Some(existing) => *existing = cluster.clone(),
            None => self.clusters.push(cluster.clone()),
        }
        self.persist()?;
        Ok(cluster)
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        self.clusters.retain(|c| c.id != id);
        self.persist()
    }

    fn persist(&self) -> Result<()> {
        json_file::save(&self.path, &self.clusters)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cluster(name: &str) -> ClusterConfig {
        serde_json::from_value(serde_json::json!({
            "name": name,
            "bootstrapServers": "localhost:9092"
        }))
        .unwrap()
    }

    #[test]
    fn save_assigns_id_and_persists_across_loads() {
        let path = std::env::temp_dir().join(format!("kui-test-{}.json", uuid::Uuid::new_v4()));
        let mut store = ClusterStore::load(path.clone()).unwrap();

        let saved = store.save(cluster("local")).unwrap();
        assert!(!saved.id.is_empty());

        let reloaded = ClusterStore::load(path.clone()).unwrap();
        assert_eq!(reloaded.get(&saved.id).unwrap().name, "local");

        store.delete(&saved.id).unwrap();
        assert!(ClusterStore::load(path.clone()).unwrap().list().is_empty());
        std::fs::remove_file(path).ok();
    }
}
