use tauri::State;

use super::model::Acl;
use super::service;
use crate::blocking::run_blocking;
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn list_acls(state: State<'_, AppState>, cluster_id: String) -> Result<Vec<Acl>> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::list(&clients)).await
}

#[tauri::command]
pub async fn create_acl(state: State<'_, AppState>, cluster_id: String, acl: Acl) -> Result<()> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::create(&clients, acl)).await
}

#[tauri::command]
pub async fn delete_acl(state: State<'_, AppState>, cluster_id: String, acl: Acl) -> Result<()> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::delete(&clients, &acl)).await
}
