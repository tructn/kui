use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::error::Result;
use crate::features::clusters::store::ClusterStore;
use crate::kafka::KafkaClients;
use crate::tasks::Tasks;

/// Global state managed by Tauri and injected into commands.
pub struct AppState {
    pub clusters: Mutex<ClusterStore>,
    clients: Mutex<HashMap<String, Arc<KafkaClients>>>,
    pub tasks: Arc<Tasks>,
}

impl AppState {
    pub fn new(clusters: ClusterStore) -> Self {
        Self { clusters: Mutex::new(clusters), clients: Mutex::default(), tasks: Arc::default() }
    }

    /// Returns cached clients for a cluster, connecting on first use.
    pub fn clients(&self, cluster_id: &str) -> Result<Arc<KafkaClients>> {
        if let Some(existing) = self.clients.lock().unwrap().get(cluster_id) {
            return Ok(existing.clone());
        }
        let config = self.clusters.lock().unwrap().get(cluster_id)?;
        let created = Arc::new(KafkaClients::connect(config)?);
        self.clients.lock().unwrap().insert(cluster_id.to_string(), created.clone());
        Ok(created)
    }

    /// Drops cached clients so the next call reconnects with fresh settings.
    pub fn forget_clients(&self, cluster_id: &str) {
        self.clients.lock().unwrap().remove(cluster_id);
    }
}
