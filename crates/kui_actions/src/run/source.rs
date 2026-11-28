use std::collections::HashMap;
use std::time::Duration;

use crate::Result;
use crate::record::Record;

/// Per (topic, partition), the next offset to read: the last finished one + 1.
pub type NextOffsets = HashMap<(String, i32), i64>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitMode {
    Async,
    /// Waits for the broker; used once on Stop.
    Sync,
}

/// Where a run reads messages from and commits its progress to. A subscribed
/// Kafka consumer in the app, a scripted fake in tests.
pub trait MessageSource {
    /// `None` when nothing arrived within `timeout`.
    fn poll(&self, timeout: Duration) -> Option<Result<Record>>;
    fn set_paused(&self, paused: bool) -> Result<()>;
    fn commit(&self, offsets: &NextOffsets, mode: CommitMode) -> Result<()>;
}
