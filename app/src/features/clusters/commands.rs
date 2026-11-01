use tauri::State;

use super::service;
use crate::blocking::run_blocking;
use crate::error::Result;
use crate::kafka::ClusterConfig;
use crate::state::AppState;

#[tauri::command]
pub fn list_clusters(state: State<'_, AppState>) -> Vec<ClusterConfig> {
    state.clusters.lock().unwrap().list()
}

#[tauri::command]
pub fn save_cluster(state: State<'_, AppState>, cluster: ClusterConfig) -> Result<ClusterConfig> {
    let saved = state.clusters.lock().unwrap().save(cluster)?;
    state.forget_clients(&saved.id);
    Ok(saved)
}

#[tauri::command]
pub fn delete_cluster(state: State<'_, AppState>, cluster_id: String) -> Result<()> {
    state.clusters.lock().unwrap().delete(&cluster_id)?;
    state.forget_clients(&cluster_id);
    Ok(())
}

#[tauri::command]
pub async fn test_connection(cluster: ClusterConfig) -> Result<usize> {
    run_blocking(move || service::test_connection(&cluster)).await
}
