//! Data that crosses IPC (camelCase) and is saved to `actions.json`.
//! Mirrored by hand in `frontend/features/actions/types.ts`.

mod action;
mod discovery;
mod endpoint;
mod execution;

pub use action::{Action, Executor, LambdaRuntime, LambdaTarget, PayloadFormat, Source, StartFrom};
pub use discovery::{ConfiguredName, DiscoveredFunction, Discovery};
pub use endpoint::EndpointCheck;
pub use execution::{Body, ExecutionDetail, ExecutionStatus, ExecutionSummary, RunState, RunStatus};
