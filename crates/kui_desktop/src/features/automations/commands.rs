use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use kui_pipeline::body;
use kui_pipeline::export::kafka_connect::{self, ConnectOptions, ConnectPlan};
use kui_pipeline::file;
use kui_pipeline::replay::{Loaded, ReplayReport, replay};
use kui_pipeline::router::Router;
use kui_pipeline::template::{self, Event, Scope};

use super::connect::{self, ConnectTarget, Published};
use super::model::{Automation, Body, BodyPreview, PreviewSample, Status, TestResult};
use super::replay::{self as source, ReplaySource};
use super::validate;
use super::{AutomationStore, Engine, webhook};
use crate::blocking::run_blocking;
use crate::error::{Error, Result};
use crate::lock::lock;
use crate::state::AppState;

use std::sync::Mutex;

#[tauri::command]
pub fn list_automations(store: State<'_, Mutex<AutomationStore>>) -> Vec<Automation> {
    lock(&store).list()
}

/// Saves the automation and, when it is enabled, (re)starts it with the new settings.
#[tauri::command]
pub fn save_automation(
    state: State<'_, AppState>,
    store: State<'_, Mutex<AutomationStore>>,
    engine: State<'_, Engine>,
    automation: Automation,
) -> Result<Automation> {
    lock(&state.clusters).get(&automation.cluster_id)?;
    let saved = lock(&store).save(automation)?;
    if saved.enabled {
        engine.start(&saved);
    } else {
        engine.stop(&saved.id);
    }
    Ok(saved)
}

#[tauri::command]
pub fn set_automation_enabled(
    store: State<'_, Mutex<AutomationStore>>,
    engine: State<'_, Engine>,
    automation_id: String,
    enabled: bool,
) -> Result<Automation> {
    let saved = lock(&store).set_enabled(&automation_id, enabled)?;
    if saved.enabled {
        engine.start(&saved);
    } else {
        engine.stop(&saved.id);
    }
    Ok(saved)
}

#[tauri::command]
pub fn delete_automation(
    store: State<'_, Mutex<AutomationStore>>,
    engine: State<'_, Engine>,
    automation_id: String,
) -> Result<()> {
    engine.remove(&automation_id);
    lock(&store).delete(&automation_id)
}

/// What each started automation is doing; one that never ran has no entry.
#[tauri::command]
pub fn automation_statuses(engine: State<'_, Engine>) -> Vec<Status> {
    engine.statuses()
}

/// Sends one route's action once with the sample message, or a made-up one without it. Only runs when
/// the user presses "Send test".
#[tauri::command]
pub async fn test_automation(
    engine: State<'_, Engine>,
    automation: Automation,
    route: usize,
    sample: Option<PreviewSample>,
) -> Result<TestResult> {
    validate::automation(&automation)?;
    let engine = engine.inner().clone();
    run_blocking(move || {
        let event = sample.as_ref().map(event_of);
        engine.test(&automation, route, event.as_ref()).map(|status| TestResult { status })
    })
    .await
}

/// Shows what the body would be for a sample message. Nothing is sent and Kafka isn't read.
#[tauri::command]
pub fn preview_automation_body(
    name: String,
    body: Body,
    split: Option<String>,
    sample: PreviewSample,
) -> Result<BodyPreview> {
    if let Some(split) = &split {
        template::validate_path(split, Scope::Message).map_err(Error::msg)?;
    }
    body::preview(&body, &name, split.as_deref(), &event_of(&sample)).map_err(Error::msg)
}

fn event_of(sample: &PreviewSample) -> Event<'_> {
    Event {
        topic: &sample.topic,
        partition: 0,
        offset: 0,
        timestamp: Some(chrono::Utc::now().timestamp_millis()),
        key: sample.key.as_deref(),
        value: sample.value.as_deref(),
        headers: sample.headers.iter().map(|h| (h.name.as_str(), Some(h.value.as_str()))).collect(),
        truncated: false,
    }
}

/// Asks where to save, then writes the pipeline as a file without its webhook URLs and header
/// values. Returns the path, or `None` when the user cancels.
#[tauri::command]
pub async fn export_pipeline_file(window: WebviewWindow, automation: Automation) -> Result<Option<String>> {
    run_blocking(move || {
        let name: String =
            automation.pipeline.name.chars().map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' }).collect();
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Save pipeline")
            .set_file_name(format!("{}.kui-pipeline.json", name.trim_matches('-')))
            .add_filter("KUI pipeline", &["json"])
            .blocking_save_file();
        let Some(chosen) = chosen else { return Ok(None) };
        let path = chosen.as_path().ok_or_else(|| Error::msg("Can't save to that location"))?.to_path_buf();
        std::fs::write(&path, file::write(&automation.pipeline))?;
        Ok(Some(path.display().to_string()))
    })
    .await
}

/// Opens a pipeline file as a new, unsaved and disabled automation on `cluster_id`. Its webhook
/// URLs and header values are blank until the user fills them in.
#[tauri::command]
pub async fn import_pipeline_file(
    window: WebviewWindow,
    state: State<'_, AppState>,
    cluster_id: String,
) -> Result<Option<Automation>> {
    lock(&state.clusters).get(&cluster_id)?;
    run_blocking(move || {
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Open pipeline")
            .add_filter("KUI pipeline", &["json"])
            .blocking_pick_file();
        let Some(chosen) = chosen else { return Ok(None) };
        let path = chosen.as_path().ok_or_else(|| Error::msg("Can't open that file"))?.to_path_buf();
        if std::fs::metadata(&path)?.len() > file::MAX_FILE as u64 {
            return Err(Error::msg("The file is too large to be a pipeline."));
        }
        let text = std::fs::read_to_string(&path).map_err(|_| Error::msg("The file isn't a KUI pipeline."))?;
        let pipeline = file::read(&text).map_err(Error::msg)?;
        Ok(Some(Automation { id: String::new(), enabled: false, cluster_id, pipeline }))
    })
    .await
}

/// Asks for a message export (JSON or NDJSON) to replay. `None` when the user cancels.
#[tauri::command]
pub async fn load_replay_file(window: WebviewWindow) -> Result<Option<Loaded>> {
    run_blocking(move || {
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Replay messages from a file")
            .add_filter("Message export", &["json", "ndjson"])
            .blocking_pick_file();
        let Some(chosen) = chosen else { return Ok(None) };
        let path = chosen.as_path().ok_or_else(|| Error::msg("Can't open that file"))?.to_path_buf();
        source::load_file(&path).map(Some)
    })
    .await
}

/// Runs the pipeline over existing messages and shows what each route would send. Nothing is sent.
#[tauri::command]
pub async fn dry_run_automation(
    state: State<'_, AppState>,
    automation: Automation,
    source: ReplaySource,
) -> Result<ReplayReport> {
    validate::pipeline(&automation.pipeline)?;
    let messages = replay_messages(&state, &automation, source).await?;
    let router = Router::new(&automation.pipeline).map_err(Error::msg)?;
    Ok(replay(&automation.pipeline, &router, &messages, None))
}

/// Runs the pipeline over existing messages and sends the requests, at most the pipeline's
/// per-minute limit of them. Only runs when the user presses "Replay and send".
#[tauri::command]
pub async fn replay_automation(
    state: State<'_, AppState>,
    engine: State<'_, Engine>,
    automation: Automation,
    source: ReplaySource,
) -> Result<ReplayReport> {
    validate::automation(&automation)?;
    let messages = replay_messages(&state, &automation, source).await?;
    let router = Router::new(&automation.pipeline).map_err(Error::msg)?;
    let engine = engine.inner().clone();
    run_blocking(move || {
        let mut send = |route: &kui_pipeline::Route, body: String| engine.send(route, body);
        Ok(replay(&automation.pipeline, &router, &messages, Some(&mut send)))
    })
    .await
}

async fn replay_messages(
    state: &AppState,
    automation: &Automation,
    source: ReplaySource,
) -> Result<Vec<kui_pipeline::replay::ReplayMessage>> {
    let messages = match source {
        ReplaySource::Messages { messages } => messages,
        ReplaySource::Topic { from, limit } => {
            let clients = state.clients(&automation.cluster_id)?;
            let topic = automation.pipeline.topic.clone();
            run_blocking(move || source::read_topic(&clients, &topic, from, limit)).await?
        }
    };
    source::check(&messages)?;
    Ok(messages)
}

/// The connectors publishing would create, with credentials hidden, and what stands in the way.
#[tauri::command]
pub fn preview_kafka_connect(automation: Automation, options: ConnectOptions) -> Result<ConnectPlan> {
    validate::pipeline(&automation.pipeline)?;
    Ok(kafka_connect::compile(&automation.pipeline, &options).redacted())
}

/// Creates or updates the pipeline's connectors on a Kafka Connect cluster, where they run on
/// their own from then on. Only runs when the user presses "Publish".
#[tauri::command]
pub async fn publish_to_kafka_connect(
    automation: Automation,
    target: ConnectTarget,
    options: ConnectOptions,
) -> Result<Vec<Published>> {
    validate::automation(&automation)?;
    connect::parse_url(&target.url).map_err(Error::msg)?;
    let plan = kafka_connect::compile(&automation.pipeline, &options);
    if let Some(blocker) = plan.blockers.first() {
        return Err(Error::msg(blocker.clone()));
    }
    let client = webhook::client()?;
    let secrets = file::secrets(&automation.pipeline);
    connect::publish(&client, &target, &plan.connectors, &secrets).await.map_err(Error::msg)
}
