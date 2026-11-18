use tauri::State;

use kui_pipeline::body;
use kui_pipeline::template::{self, Event, Scope};

use super::model::{Automation, Body, BodyPreview, PreviewSample, Status, TestResult};
use super::{AutomationStore, Engine, validate};
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
