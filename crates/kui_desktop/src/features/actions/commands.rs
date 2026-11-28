use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use kui_actions::model::{
    Action, EndpointCheck, ExecutionDetail, ExecutionSummary, LambdaRuntime, RunState, RunStatus,
};
use kui_actions::{executor, kafka, lambda, run, share, validate};

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

/// Asks for an actions file a teammate shared and adds its Actions to
/// `cluster_id`. `None` when the user cancels. Rust opens the window and reads
/// the file, so the webview never gets file-system access.
#[tauri::command]
pub async fn import_actions(
    window: WebviewWindow,
    actions: State<'_, ActionsState>,
    cluster_id: String,
) -> Result<Option<Vec<Action>>> {
    let shared = run_blocking(move || {
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Import actions")
            .add_filter("JSON", &["json"])
            .blocking_pick_file();
        let Some(chosen) = chosen else { return Ok(None) };
        let path = chosen.as_path().ok_or_else(|| Error::msg("Can't open a file from that location"))?;
        Ok(Some(share::parse(&share::read_file(path)?)?))
    })
    .await?;
    let Some(shared) = shared else { return Ok(None) };
    Ok(Some(lock(&actions.store).import(&cluster_id, shared)?))
}

/// Asks where to save, then writes the Actions in `action_ids` to a file
/// teammates can import. Returns the path, or `None` when the user cancels.
#[tauri::command]
pub async fn export_actions(
    window: WebviewWindow,
    actions: State<'_, ActionsState>,
    cluster_id: String,
    action_ids: Vec<String>,
) -> Result<Option<String>> {
    let chosen: Vec<Action> =
        lock(&actions.store).list(&cluster_id).into_iter().filter(|a| action_ids.contains(&a.id)).collect();
    let file_name = match chosen.as_slice() {
        [] => return Err(Error::msg("Choose at least one action to export")),
        [one] => format!("{}.kui-actions.json", file_stem(&one.name)),
        _ => "kui-actions.json".to_string(),
    };
    let json = share::export(&chosen)?;
    run_blocking(move || {
        let target = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Export actions")
            .set_file_name(file_name)
            .add_filter("JSON", &["json"])
            .blocking_save_file();
        let Some(target) = target else { return Ok(None) };
        let path = target.as_path().ok_or_else(|| Error::msg("Can't save to that location"))?;
        std::fs::write(path, json)?;
        Ok(Some(path.display().to_string()))
    })
    .await
}

fn file_stem(name: &str) -> String {
    let stem: String = name.chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' }).collect();
    let stem = stem.trim_matches('-');
    if stem.is_empty() { "action".into() } else { stem.to_lowercase() }
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

/// Sends the message at `partition`/`offset` of the Action's topic to its
/// target once and returns what came back. For stepping through one message
/// in a debugger: it waits up to `executor::SEND_ONE_TIMEOUT`, no other
/// message arrives meanwhile, and no offset is committed. While it waits the
/// Action shows as running, so Stop cancels it and Start waits for it.
#[tauri::command]
pub async fn send_to_action(
    state: State<'_, AppState>,
    actions: State<'_, ActionsState>,
    action_id: String,
    partition: i32,
    offset: i64,
) -> Result<ExecutionDetail> {
    if partition < 0 || offset < 0 {
        return Err(Error::msg("That message position is not valid"));
    }
    let action = lock(&actions.store).get(&action_id)?;
    let log = actions.log(&action_id);
    if log.status().state.is_active() {
        return Err(Error::msg("Stop the action first, so this message isn't queued behind the stream"));
    }
    log.begin()?;
    let cancel = state.tasks.start(&task_id(&action_id));
    log.set_state(RunState::Running);

    let sent = async {
        let cluster = state.clients(&action.cluster_id)?.cluster.clone();
        let executor = executor::for_one_message(&action.executor);
        executor::check_target(&executor).await?;
        let plan = executor::plan(&Action { executor, ..action.clone() }, &cluster)?;
        let topic = action.source.topic.clone();
        let record = run_blocking(move || Ok(kafka::fetch(&cluster, &topic, partition, offset)?)).await?;
        Ok::<_, Error>(run::send_one(record, &plan, &log, || cancel.is_cancelled()).await?)
    }
    .await;
    // The error goes back to the caller; it doesn't mark the Action itself as failed.
    log.finish(Ok(()));
    sent
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
