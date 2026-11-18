use tauri::State;

use super::model::AclBinding;
use super::service;
use crate::blocking::run_blocking;
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn list_acls(state: State<'_, AppState>, cluster_id: String) -> Result<Vec<AclBinding>> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::list(&clients)).await
}

#[tauri::command]
pub async fn create_acls(state: State<'_, AppState>, cluster_id: String, acls: Vec<AclBinding>) -> Result<()> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::create(&clients, &acls)).await
}

/// Deletes exactly the given ACLs; returns how many were removed.
#[tauri::command]
pub async fn delete_acls(state: State<'_, AppState>, cluster_id: String, acls: Vec<AclBinding>) -> Result<usize> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::delete(&clients, &acls)).await
}
