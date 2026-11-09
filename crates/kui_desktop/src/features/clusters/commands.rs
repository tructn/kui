use tauri::State;

use super::service;
use crate::blocking::run_blocking;
use crate::error::Result;
use crate::lock::lock;
use crate::state::AppState;
use kui_kafka::ClusterConfig;

#[tauri::command]
pub fn list_clusters(state: State<'_, AppState>) -> Vec<ClusterConfig> {
    lock(&state.clusters).list()
}

#[tauri::command]
pub fn save_cluster(state: State<'_, AppState>, cluster: ClusterConfig) -> Result<ClusterConfig> {
    let saved = lock(&state.clusters).save(cluster)?;
    state.forget_clients(&saved.id);
    Ok(saved)
}

#[tauri::command]
pub fn delete_cluster(state: State<'_, AppState>, cluster_id: String) -> Result<()> {
    lock(&state.clusters).delete(&cluster_id)?;
    state.forget_clients(&cluster_id);
    Ok(())
}

#[tauri::command]
pub async fn test_connection(cluster: ClusterConfig) -> Result<usize> {
    run_blocking(move || service::test_connection(&cluster)).await
}
