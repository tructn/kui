use crate::error::{Error, Result};

/// Runs blocking librdkafka work on Tauri's blocking thread pool so it never
/// stalls the async runtime that handles IPC from the UI.
pub async fn run_blocking<T, F>(work: F) -> Result<T>
where
    F: FnOnce() -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| Error::msg(format!("Background task failed: {e}")))?
}
