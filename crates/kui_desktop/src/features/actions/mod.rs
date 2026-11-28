//! Actions: run a local Lambda function (through AWS SAM) for each message of a
//! topic. The logic lives in the `kui_actions` crate; this feature saves
//! Actions, keeps their run logs and adapts them to commands.

pub mod commands;
pub mod store;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use kui_actions::run::RunLog;

use crate::lock::lock;
use store::ActionStore;

/// Managed by Tauri next to `AppState`.
pub struct ActionsState {
    pub store: Mutex<ActionStore>,
    /// Kept after a run ends, so its history stays readable.
    runs: Mutex<HashMap<String, Arc<RunLog>>>,
}

impl ActionsState {
    pub fn new(store: ActionStore) -> Self {
        Self { store: Mutex::new(store), runs: Mutex::default() }
    }

    pub fn log(&self, action_id: &str) -> Arc<RunLog> {
        lock(&self.runs).entry(action_id.to_string()).or_insert_with(|| Arc::new(RunLog::new(action_id))).clone()
    }

    fn is_active(&self, action_id: &str) -> bool {
        lock(&self.runs).get(action_id).is_some_and(|log| log.status().state.is_active())
    }

    fn forget(&self, action_id: &str) {
        lock(&self.runs).remove(action_id);
    }
}

/// The `Tasks` id of an Action's run, so Stop goes through the shared cancel registry.
fn task_id(action_id: &str) -> String {
    format!("action:{action_id}")
}
