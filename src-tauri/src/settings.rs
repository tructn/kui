//! UI preferences (theme, fonts, last cluster...) saved to
//! `settings.json` in the app config directory, next to `clusters.json`.
//!
//! The Rust side doesn't interpret them: the UI's zustand stores each own one
//! key and store whatever JSON they like under it (see `src/lib/settings-storage.ts`).
//! Keeping them in a file rather than the webview's localStorage means every
//! change is on disk right away and survives quitting or reinstalling the app.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::{Map, Value};
use tauri::State;

use crate::blocking::run_blocking;
use crate::error::Result;
use crate::json_file;

/// Cheap to clone: clones share the same values, so a save can move one onto
/// a blocking thread.
#[derive(Clone)]
pub struct SettingsStore {
    path: PathBuf,
    values: Arc<Mutex<Map<String, Value>>>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Result<Self> {
        let values = json_file::load(&path)?;
        Ok(Self { path, values: Arc::new(Mutex::new(values)) })
    }

    fn all(&self) -> Map<String, Value> {
        self.values.lock().unwrap().clone()
    }

    /// Sets (or with `None`, removes) one key and writes the file.
    fn set(&self, key: String, value: Option<Value>) -> Result<()> {
        let mut values = self.values.lock().unwrap();
        match value {
            Some(value) => values.insert(key, value),
            None => values.remove(&key),
        };
        json_file::save(&self.path, &*values)
    }
}

#[tauri::command]
pub fn load_settings(store: State<'_, SettingsStore>) -> Map<String, Value> {
    store.all()
}

/// Async so writing (and fsyncing) the file never blocks the main thread, which
/// runs synchronous commands. The UI sends one save at a time, so they reach
/// the disk in order (see `src/lib/settings-storage.ts`).
#[tauri::command]
pub async fn save_setting(store: State<'_, SettingsStore>, key: String, value: Option<Value>) -> Result<()> {
    let store = store.inner().clone();
    run_blocking(move || store.set(key, value)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_persist_across_loads() {
        let path = std::env::temp_dir().join(format!("kui-settings-{}.json", uuid::Uuid::new_v4()));
        let store = SettingsStore::load(path.clone()).unwrap();
        store.set("kui.theme".into(), Some(serde_json::json!({ "state": { "theme": "light" } }))).unwrap();
        store.set("gone".into(), Some(Value::Bool(true))).unwrap();
        store.set("gone".into(), None).unwrap();

        let reloaded = SettingsStore::load(path.clone()).unwrap().all();
        assert_eq!(reloaded["kui.theme"]["state"]["theme"], "light");
        assert!(!reloaded.contains_key("gone"));
        std::fs::remove_file(path).ok();
    }
}
