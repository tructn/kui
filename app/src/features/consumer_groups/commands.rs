use tauri::State;

use super::model::{GroupDetail, GroupLag, GroupSummary, OffsetChange, ResetRequest, TopicConsumer};
use super::service;
use crate::blocking::run_blocking;
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn list_consumer_groups(state: State<'_, AppState>, cluster_id: String) -> Result<Vec<GroupSummary>> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::list(&clients)).await
}

#[tauri::command]
pub async fn consumer_group_detail(
    state: State<'_, AppState>,
    cluster_id: String,
    group: String,
) -> Result<GroupDetail> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::detail(&clients, &group)).await
}

#[tauri::command]
pub async fn consumer_group_lags(state: State<'_, AppState>, cluster_id: String) -> Result<Vec<GroupLag>> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::lags(&clients)).await
}

#[tauri::command]
pub async fn topic_consumer_groups(
    state: State<'_, AppState>,
    cluster_id: String,
    topic: String,
) -> Result<Vec<TopicConsumer>> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::topic_consumers(&clients, &topic)).await
}

#[tauri::command]
pub async fn delete_consumer_group(state: State<'_, AppState>, cluster_id: String, group: String) -> Result<()> {
    let clients = state.clients(&cluster_id)?;
    service::delete(&clients, &group).await
}

/// Previews a reset: each partition's current and new offset. Changes nothing.
#[tauri::command]
pub async fn preview_offset_reset(
    state: State<'_, AppState>,
    cluster_id: String,
    request: ResetRequest,
) -> Result<Vec<OffsetChange>> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::plan_reset(&clients, &request)).await
}

/// Moves a group's committed offsets (earliest, latest, a time or an offset).
#[tauri::command]
pub async fn reset_consumer_group_offsets(
    state: State<'_, AppState>,
    cluster_id: String,
    request: ResetRequest,
) -> Result<Vec<OffsetChange>> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::reset_offsets(&clients, &request)).await
}
