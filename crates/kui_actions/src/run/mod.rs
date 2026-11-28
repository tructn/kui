//! Running an Action: consume, invoke, record, commit.
//!
//! Delivery is at-least-once. Each partition has at most one invocation in
//! flight, and its offset is committed only after that invocation finishes
//! (succeeded or not), so per-partition order holds and a commit never skips a
//! message that hasn't run. Stopping or crashing between the invocation and
//! the commit runs that message again on the next start.
//!
//! `send_one` is the other way in: one message picked in the message table,
//! read by position and sent once, with no group and nothing committed.

mod body;
mod log;
mod plan;
mod runner;
mod scheduler;
mod single;
mod source;

pub use body::BODY_LIMIT;
pub use log::{HISTORY_LIMIT, RunLog};
pub use plan::{BuildPayload, Invocation, Outcome, Plan};
pub use runner::run;
pub use single::send_one;
pub use source::{CommitMode, MessageSource, NextOffsets};
