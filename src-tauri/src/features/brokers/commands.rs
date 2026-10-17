use tauri::State;

use super::model::ClusterOverview;
use super::service;
use crate::blocking::run_blocking;
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn cluster_overview(state: State<'_, AppState>, cluster_id: String) -> Result<ClusterOverview> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::cluster_overview(&clients)).await
}
