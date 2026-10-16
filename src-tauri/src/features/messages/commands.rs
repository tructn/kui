use tauri::State;
use tauri::ipc::Channel;

use super::model::{BrowsePage, BrowseRequest, CopyRequest, Delivered, Message, ProduceRequest, TailRequest};
use super::service;
use crate::blocking::run_blocking;
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn browse_messages(
    state: State<'_, AppState>,
    cluster_id: String,
    request: BrowseRequest,
) -> Result<BrowsePage> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || service::browse(&clients, &request)).await
}

#[tauri::command]
pub async fn produce_message(
    state: State<'_, AppState>,
    cluster_id: String,
    request: ProduceRequest,
) -> Result<Delivered> {
    let clients = state.clients(&cluster_id)?;
    service::produce(&clients, &request).await
}

/// Copies one message to another topic, or duplicates it in the same one.
#[tauri::command]
pub async fn copy_message(state: State<'_, AppState>, cluster_id: String, request: CopyRequest) -> Result<Delivered> {
    let clients = state.clients(&cluster_id)?;
    service::copy(clients, &request).await
}

/// Streams new messages to `channel` until `cancel_task(task_id)` is called.
#[tauri::command]
pub async fn tail_messages(
    state: State<'_, AppState>,
    cluster_id: String,
    task_id: String,
    request: TailRequest,
    channel: Channel<Vec<Message>>,
) -> Result<()> {
    let clients = state.clients(&cluster_id)?;
    let cancel = state.tasks.start(&task_id);
    run_blocking(move || service::tail(&clients, &request, &cancel, |batch| channel.send(batch).is_ok())).await
}
