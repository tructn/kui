use std::collections::VecDeque;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use super::body::{body, preview};
use super::plan::Outcome;
use crate::model::{Body, ExecutionDetail, ExecutionStatus, ExecutionSummary, RunState, RunStatus};
use crate::record::Record;
use crate::{Error, Result};

/// Executions kept per Action; older ones are dropped.
pub const HISTORY_LIMIT: usize = 500;
const KEY_PREVIEW_CHARS: usize = 120;

/// One invocation, finished, on its way into the history.
pub struct Finished {
    pub record: Record,
    pub request: Option<Body>,
    pub outcome: Outcome,
    /// Epoch milliseconds.
    pub started_at: i64,
    pub elapsed: Duration,
}

/// An Action's status and execution history, shared between its run and the UI.
pub struct RunLog {
    inner: Mutex<LogInner>,
}

struct LogInner {
    status: RunStatus,
    history: VecDeque<ExecutionDetail>,
    next_id: u64,
}

impl RunLog {
    pub fn new(action_id: &str) -> Self {
        let status = RunStatus {
            action_id: action_id.to_string(),
            state: RunState::Stopped,
            processed: 0,
            failed: 0,
            in_flight: 0,
            started_at: None,
        };
        RunLog { inner: Mutex::new(LogInner { status, history: VecDeque::new(), next_id: 1 }) }
    }

    fn lock(&self) -> MutexGuard<'_, LogInner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn status(&self) -> RunStatus {
        self.lock().status.clone()
    }

    /// Marks the Action as starting, unless a run is already going.
    pub fn begin(&self) -> Result<()> {
        let mut inner = self.lock();
        if inner.status.state.is_active() {
            return Err(Error::msg("This action is already running"));
        }
        inner.status = RunStatus {
            state: RunState::Starting,
            processed: 0,
            failed: 0,
            in_flight: 0,
            started_at: Some(now_ms()),
            ..inner.status.clone()
        };
        Ok(())
    }

    pub fn set_state(&self, state: RunState) {
        self.lock().status.state = state;
    }

    pub fn finish(&self, result: Result<()>) {
        let mut inner = self.lock();
        inner.status.in_flight = 0;
        inner.status.state = match result {
            Ok(()) => RunState::Stopped,
            Err(e) => RunState::Failed { message: e.to_string() },
        };
    }

    /// For a run that failed before it started consuming.
    pub fn fail(&self, message: String) {
        self.finish(Err(Error::Msg(message)));
    }

    pub fn clear(&self) {
        self.lock().history.clear();
    }

    /// Newest first.
    pub fn summaries(&self) -> Vec<ExecutionSummary> {
        self.lock().history.iter().rev().map(|e| e.summary.clone()).collect()
    }

    pub fn detail(&self, id: u64) -> Option<ExecutionDetail> {
        self.lock().history.iter().find(|e| e.summary.id == id).cloned()
    }

    pub(super) fn set_in_flight(&self, in_flight: usize) {
        self.lock().status.in_flight = u32::try_from(in_flight).unwrap_or(u32::MAX);
    }

    pub(super) fn record(&self, target: &str, done: Finished) {
        let mut inner = self.lock();
        inner.status.processed += 1;
        if done.outcome.status != ExecutionStatus::Succeeded {
            inner.status.failed += 1;
        }
        let id = inner.next_id;
        inner.next_id += 1;
        inner.history.push_back(detail(id, target, done));
        if inner.history.len() > HISTORY_LIMIT {
            inner.history.pop_front();
        }
    }
}

fn detail(id: u64, target: &str, done: Finished) -> ExecutionDetail {
    let Finished { record, request, outcome, started_at, elapsed } = done;
    ExecutionDetail {
        summary: ExecutionSummary {
            id,
            partition: record.partition,
            offset: record.offset,
            timestamp: record.timestamp,
            key: record.key.as_deref().map(|k| preview(k, KEY_PREVIEW_CHARS)),
            status: outcome.status,
            started_at,
            duration_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
            error: outcome.error,
        },
        function: target.to_string(),
        request,
        response: outcome.response.as_deref().map(body),
    }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finished(offset: i64, status: ExecutionStatus) -> Finished {
        Finished {
            record: Record::sample(0, offset),
            request: Some(body(b"{}")),
            outcome: Outcome { status, response: None, error: None, retryable: false },
            started_at: 0,
            elapsed: Duration::from_millis(5),
        }
    }

    #[test]
    fn begin_refuses_a_second_run() {
        let log = RunLog::new("a");
        log.begin().unwrap();
        assert!(log.begin().is_err());
        log.finish(Ok(()));
        assert_eq!(log.status().state, RunState::Stopped);
        assert!(log.begin().is_ok());
    }

    #[test]
    fn failures_keep_their_message() {
        let log = RunLog::new("a");
        log.begin().unwrap();
        log.finish(Err(Error::msg("broker down")));
        assert_eq!(log.status().state, RunState::Failed { message: "broker down".into() });
    }

    #[test]
    fn history_counts_failures_and_keeps_the_newest() {
        let log = RunLog::new("a");
        for offset in 0..(HISTORY_LIMIT as i64 + 10) {
            let status = if offset % 2 == 0 { ExecutionStatus::Succeeded } else { ExecutionStatus::FunctionError };
            log.record("Fn", finished(offset, status));
        }
        let status = log.status();
        assert_eq!(status.processed, HISTORY_LIMIT as u64 + 10);
        assert_eq!(status.failed, (HISTORY_LIMIT as u64 + 10) / 2);
        let rows = log.summaries();
        assert_eq!(rows.len(), HISTORY_LIMIT);
        assert_eq!(rows[0].offset, HISTORY_LIMIT as i64 + 9);
        assert_eq!(log.detail(rows[0].id).unwrap().function, "Fn");
        log.clear();
        assert!(log.summaries().is_empty());
    }
}
