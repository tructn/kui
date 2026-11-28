use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunState {
    Stopped,
    Starting,
    Running,
    /// Waiting for in-flight invocations before leaving the group.
    Stopping,
    Failed {
        message: String,
    },
}

impl RunState {
    pub fn is_active(&self) -> bool {
        matches!(self, RunState::Starting | RunState::Running | RunState::Stopping)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStatus {
    pub action_id: String,
    pub state: RunState,
    /// Counters for the current (or last) run.
    pub processed: u64,
    pub failed: u64,
    pub in_flight: u32,
    /// Epoch milliseconds.
    pub started_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionStatus {
    Succeeded,
    /// The handler ran and threw (Lambda's `X-Amz-Function-Error`).
    FunctionError,
    /// KUI couldn't invoke it: endpoint down, function not found, bad payload.
    Failed,
    TimedOut,
}

/// One row of execution history, without the bodies.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionSummary {
    pub id: u64,
    pub partition: i32,
    pub offset: i64,
    /// Message timestamp, epoch milliseconds.
    pub timestamp: Option<i64>,
    /// A short text preview of the message key.
    pub key: Option<String>,
    pub status: ExecutionStatus,
    /// Epoch milliseconds.
    pub started_at: i64,
    pub duration_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionDetail {
    #[serde(flatten)]
    pub summary: ExecutionSummary,
    pub function: String,
    pub request: Option<Body>,
    pub response: Option<Body>,
}

/// A payload as text, cut to a size the UI can show.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Body {
    pub text: String,
    pub truncated: bool,
}
