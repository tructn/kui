use tauri::ipc::Channel;
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use super::model::{
    BrowsePage, BrowseRequest, CopyRequest, Delivered, ExportRequest, Exported, Message, ProduceRequest, TailRequest,
};
use super::service;
use crate::blocking::run_blocking;
use crate::error::{Error, Result};
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

/// Copies messages to another topic, or duplicates them in the same one.
#[tauri::command]
pub async fn copy_messages(
    state: State<'_, AppState>,
    cluster_id: String,
    request: CopyRequest,
) -> Result<Vec<Delivered>> {
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

/// Asks where to save, then exports messages there. `None` when the user cancels.
///
/// The save window opens from Rust and the file is written here, so the
/// webview never gets file-system access or picks a path itself.
#[tauri::command]
pub async fn export_messages(
    window: WebviewWindow,
    state: State<'_, AppState>,
    cluster_id: String,
    request: ExportRequest,
) -> Result<Option<Exported>> {
    let clients = state.clients(&cluster_id)?;
    run_blocking(move || {
        let ext = request.format.extension();
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Export messages")
            .set_file_name(format!("{}-{stamp}.{ext}", request.topic()))
            .add_filter(ext.to_uppercase(), &[ext])
            .blocking_save_file();
        let Some(chosen) = chosen else { return Ok(None) };
        let path = chosen.as_path().ok_or_else(|| Error::msg("Can't save to that location"))?.to_path_buf();
        let count = service::export_to_file(&clients, &request, &path)?;
        Ok(Some(Exported { path: path.display().to_string(), count }))
    })
    .await
}
