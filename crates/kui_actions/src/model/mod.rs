//! Data that crosses IPC (camelCase) and is saved to `actions.json`.
//! Mirrored by hand in `frontend/features/actions/types.ts`.

mod action;
mod endpoint;
mod execution;

pub use action::{Action, Executor, LambdaRuntime, LambdaTarget, Source, StartFrom};
pub use endpoint::EndpointCheck;
pub use execution::{Body, ExecutionDetail, ExecutionStatus, ExecutionSummary, RunState, RunStatus};
