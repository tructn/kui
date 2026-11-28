//! Running an Action: consume, invoke, record, commit.
//!
//! Delivery is at-least-once. Each partition has at most one invocation in
//! flight, and its offset is committed only after that invocation finishes
//! (succeeded or not), so per-partition order holds and a commit never skips a
//! message that hasn't run. Stopping or crashing between the invocation and
//! the commit runs that message again on the next start.

mod body;
mod log;
mod plan;
mod runner;
mod scheduler;
mod source;

pub use body::BODY_LIMIT;
pub use log::{HISTORY_LIMIT, RunLog};
pub use plan::{BuildPayload, Invocation, Outcome, Plan};
pub use runner::run;
pub use source::{CommitMode, MessageSource, NextOffsets};
