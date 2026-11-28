use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use crate::model::ExecutionStatus;
use crate::record::Record;

pub type Invocation = Pin<Box<dyn Future<Output = Outcome> + Send>>;
/// Builds a record's request body, or says why it can't be sent.
pub type BuildPayload = Box<dyn Fn(&Record) -> std::result::Result<Vec<u8>, String> + Send + Sync>;

/// What a running Action does with each message. Each executor builds one, so
/// the runner never knows which kind of target it is calling.
pub struct Plan {
    /// Shown in history, e.g. the function's logical ID.
    pub target: String,
    pub concurrency: usize,
    /// How long Stop waits for in-flight invocations.
    pub stop_grace: Duration,
    pub build: BuildPayload,
    pub invoke: Arc<dyn Fn(Vec<u8>) -> Invocation + Send + Sync>,
    /// Stop at the first retryable outcome without committing it, so the next
    /// Start sends that message again. For debugging, where "no answer in time"
    /// usually means someone is paused at a breakpoint.
    pub stop_on_retryable: bool,
}

/// What an invocation came back with.
#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    pub status: ExecutionStatus,
    pub response: Option<Vec<u8>>,
    pub error: Option<String>,
    /// Nothing handled the message, for a reason that can clear up: the
    /// endpoint is down, the function isn't there yet, or no answer came in
    /// time. A payload the target rejects is not retryable.
    pub retryable: bool,
}

impl Outcome {
    pub fn failed(error: impl Into<String>) -> Self {
        Outcome { status: ExecutionStatus::Failed, response: None, error: Some(error.into()), retryable: false }
    }

    pub fn unanswered(status: ExecutionStatus, error: impl Into<String>) -> Self {
        Outcome { status, response: None, error: Some(error.into()), retryable: true }
    }
}
