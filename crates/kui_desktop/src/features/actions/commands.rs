use std::path::PathBuf;

use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use kui_actions::model::{
    Action, Discovery, EndpointCheck, ExecutionDetail, ExecutionSummary, LambdaRuntime, RunState, RunStatus,
};
use kui_actions::{discovery, executor, kafka, lambda, run, validate};

use super::{ActionsState, task_id};
use crate::blocking::run_blocking;
use crate::error::{Error, Result};
use crate::lock::lock;
use crate::state::AppState;

#[tauri::command]
pub fn list_actions(actions: State<'_, ActionsState>, cluster_id: String) -> Vec<Action> {
    lock(&actions.store).list(&cluster_id)
}

/// Creates (empty id) or updates an Action. A running one must be stopped first,
/// so a run never uses settings the user no longer sees.
#[tauri::command]
pub fn save_action(actions: State<'_, ActionsState>, action: Action) -> Result<Action> {
    if !action.id.is_empty() && actions.is_active(&action.id) {
        return Err(Error::msg("Stop the action before changing it"));
    }
    lock(&actions.store).save(action)
}

#[tauri::command]
pub fn delete_action(actions: State<'_, ActionsState>, action_id: String) -> Result<()> {
    if actions.is_active(&action_id) {
        return Err(Error::msg("Stop the action before deleting it"));
    }
    lock(&actions.store).delete(&action_id)?;
    actions.forget(&action_id);
    Ok(())
}

#[tauri::command]
pub fn action_statuses(actions: State<'_, ActionsState>, cluster_id: String) -> Vec<RunStatus> {
    let ids: Vec<String> = lock(&actions.store).list(&cluster_id).into_iter().map(|a| a.id).collect();
    ids.iter().map(|id| actions.log(id).status()).collect()
}

/// Joins the Action's consumer group and starts invoking. Returns once the
/// target answered and the consumer is subscribed; the run goes on in the
/// background until `stop_action`.
#[tauri::command]
pub async fn start_action(
    state: State<'_, AppState>,
    actions: State<'_, ActionsState>,
    action_id: String,
) -> Result<RunStatus> {
    let action = lock(&actions.store).get(&action_id)?;
    let log = actions.log(&action_id);
    log.begin()?;
    let cancel = state.tasks.start(&task_id(&action_id));

    let prepared = async {
        let cluster = state.clients(&action.cluster_id)?.cluster.clone();
        executor::check_target(&action.executor).await?;
        let plan = executor::plan(&action, &cluster)?;
        let source = action.source.clone();
        let consumer = run_blocking(move || Ok(kafka::subscribe(&cluster, &source)?)).await?;
        Ok::<_, Error>((plan, consumer))
    }
    .await;
    let (plan, consumer) = match prepared {
        Ok(prepared) => prepared,
        Err(e) => {
            log.fail(e.to_string());
            return Err(e);
        }
    };

    let runtime = tokio::runtime::Handle::current();
    let background = log.clone();
    std::thread::Builder::new()
        .name("kui-action".into())
        .spawn(move || {
            let result = run::run(&consumer, &plan, &background, &runtime, || cancel.is_cancelled());
            // Leave the group before reporting Stopped, so a quick restart doesn't race the old member.
            drop(consumer);
            background.finish(result);
        })
        .map_err(|e| {
            log.fail(e.to_string());
            Error::from(e)
        })?;
    Ok(log.status())
}

/// Asks a running Action to stop. In-flight invocations finish first.
#[tauri::command]
pub fn stop_action(state: State<'_, AppState>, actions: State<'_, ActionsState>, action_id: String) -> bool {
    let stopping = state.tasks.cancel(&task_id(&action_id));
    if stopping {
        actions.log(&action_id).set_state(RunState::Stopping);
    }
    stopping
}

/// Newest first, without request and response bodies.
#[tauri::command]
pub fn action_history(actions: State<'_, ActionsState>, action_id: String) -> Vec<ExecutionSummary> {
    actions.log(&action_id).summaries()
}

#[tauri::command]
pub fn action_execution(
    actions: State<'_, ActionsState>,
    action_id: String,
    execution_id: u64,
) -> Option<ExecutionDetail> {
    actions.log(&action_id).detail(execution_id)
}

#[tauri::command]
pub fn clear_action_history(actions: State<'_, ActionsState>, action_id: String) {
    actions.log(&action_id).clear();
}

#[tauri::command]
pub async fn check_lambda_endpoint(endpoint: String, runtime: LambdaRuntime) -> Result<EndpointCheck> {
    let endpoint = validate::endpoint(&endpoint)?;
    Ok(lambda::check_endpoint(&lambda::client()?, &endpoint, runtime).await)
}

/// Lists the functions in a SAM project. Without `project_dir` it asks for the
/// folder; `None` when the user cancels.
///
/// The folder window opens from Rust, so the webview never gets file-system
/// access. A saved `project_dir` can be read again without asking; only its
/// SAM template is read, and only the function list comes back.
#[tauri::command]
pub async fn discover_lambda_functions(
    window: WebviewWindow,
    project_dir: Option<String>,
) -> Result<Option<Discovery>> {
    run_blocking(move || {
        let dir = match project_dir {
            Some(dir) => PathBuf::from(dir),
            None => {
                let chosen = window
                    .dialog()
                    .file()
                    .set_parent(&window)
                    .set_title("Choose the SAM project folder")
                    .blocking_pick_folder();
                let Some(chosen) = chosen else { return Ok(None) };
                chosen.as_path().ok_or_else(|| Error::msg("Can't read that location"))?.to_path_buf()
            }
        };
        if !dir.is_absolute() || !dir.is_dir() {
            return Err(Error::msg("That project folder no longer exists"));
        }
        Ok(Some(discovery::discover(&dir)?))
    })
    .await
}
