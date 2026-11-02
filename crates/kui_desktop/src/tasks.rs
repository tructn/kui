//! Long-running jobs the UI can stop: live tail and data generation.
//!
//! The UI picks the task id (a UUID) and passes it to the command that starts the
//! work, so it can call `cancel_task` at any time, even before that command returns.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::State;

use crate::state::AppState;

#[derive(Default)]
pub struct Tasks {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Tasks {
    /// Registers a task. It stays cancellable until the returned token is dropped.
    pub fn start(self: &Arc<Self>, id: &str) -> CancelToken {
        let flag = Arc::new(AtomicBool::new(false));
        self.running.lock().unwrap().insert(id.to_string(), flag.clone());
        CancelToken { flag, registry: Some((self.clone(), id.to_string())) }
    }

    /// Asks a task to stop. Returns false if it already finished.
    pub fn cancel(&self, id: &str) -> bool {
        match self.running.lock().unwrap().get(id) {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }
}

/// Checked by a running task to know when to stop. Unregisters the task on drop.
pub struct CancelToken {
    flag: Arc<AtomicBool>,
    registry: Option<(Arc<Tasks>, String)>,
}

impl CancelToken {
    /// A token nobody can cancel, for tests and one-shot calls.
    #[allow(dead_code)]
    pub fn never() -> Self {
        Self { flag: Arc::default(), registry: None }
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }
}

impl Drop for CancelToken {
    fn drop(&mut self) {
        if let Some((tasks, id)) = &self.registry {
            tasks.running.lock().unwrap().remove(id);
        }
    }
}

#[tauri::command]
pub fn cancel_task(state: State<'_, AppState>, task_id: String) -> bool {
    state.tasks.cancel(&task_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_reaches_the_token_and_drop_unregisters() {
        let tasks = Arc::new(Tasks::default());
        let token = tasks.start("a");
        assert!(!token.is_cancelled());
        assert!(tasks.cancel("a"));
        assert!(token.is_cancelled());
        drop(token);
        assert!(!tasks.cancel("a"));
    }
}
