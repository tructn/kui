use tauri::State;

use super::model::{Automation, Body, PreviewSample, Status, TestResult};
use super::template::Event;
use super::{AutomationStore, Engine, body, validate};
use crate::blocking::run_blocking;
use crate::error::Result;
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

/// Sends the action once with a sample message. Only runs when the user presses "Send test".
#[tauri::command]
pub async fn test_automation(engine: State<'_, Engine>, automation: Automation) -> Result<TestResult> {
    validate::automation(&automation)?;
    let engine = engine.inner().clone();
    run_blocking(move || engine.test(&automation).map(|status| TestResult { status })).await
}

/// Shows what the body would be for a sample message. Nothing is sent and Kafka isn't read.
#[tauri::command]
pub fn preview_automation_body(name: String, body: Body, sample: PreviewSample) -> Result<String> {
    let event = Event {
        topic: &sample.topic,
        partition: 0,
        offset: 0,
        timestamp: Some(chrono::Utc::now().timestamp_millis()),
        key: sample.key.as_deref(),
        value: sample.value.as_deref(),
        headers: sample.headers.iter().map(|h| (h.name.as_str(), Some(h.value.as_str()))).collect(),
        truncated: false,
    };
    body::preview(&body, &name, &event).map_err(crate::error::Error::msg)
}
