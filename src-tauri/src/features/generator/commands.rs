use tauri::State;
use tauri::ipc::Channel;

use super::model::{GenerateProgress, GenerateRequest, GeneratedRecord, GeneratorInfo, RecordTemplate};
use super::{service, template};
use crate::error::Result;
use crate::state::AppState;

/// The placeholder cheat sheet.
#[tauri::command]
pub fn list_generators() -> Vec<GeneratorInfo> {
    template::generator_infos()
}

#[tauri::command]
pub fn preview_records(template: RecordTemplate, count: usize) -> Result<Vec<GeneratedRecord>> {
    service::preview(&template, count)
}

/// Produces generated records, streaming progress to `channel`.
/// Stop early with `cancel_task(task_id)`.
#[tauri::command]
pub async fn generate_records(
    state: State<'_, AppState>,
    cluster_id: String,
    task_id: String,
    request: GenerateRequest,
    channel: Channel<GenerateProgress>,
) -> Result<GenerateProgress> {
    let clients = state.clients(&cluster_id)?;
    let cancel = state.tasks.start(&task_id);
    service::generate(&clients, &request, &cancel, |p| {
        let _ = channel.send(p.clone());
    })
    .await
}
