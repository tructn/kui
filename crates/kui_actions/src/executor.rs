//! Turns a saved Action's executor into the plan its run uses. A new executor
//! is a new `Executor` variant with its own module; these `match`es are the
//! only places it plugs in.

use std::time::Duration;

use kui_kafka::ClusterConfig;

use crate::model::{Action, Executor, LambdaTarget};
use crate::run::Plan;
use crate::{Result, lambda};

/// Checks that the target answers before a run starts.
pub async fn check_target(executor: &Executor) -> Result<()> {
    match executor {
        Executor::LocalLambda(target) => lambda::check_target(target).await,
    }
}

pub fn plan(action: &Action, cluster: &ClusterConfig) -> Result<Plan> {
    match &action.executor {
        Executor::LocalLambda(target) => lambda::plan(target, cluster),
    }
}

/// How long a message sent on its own waits for an answer: Lambda's own
/// maximum, so someone stepping through the handler isn't cut off.
pub const SEND_ONE_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// The Action's executor, tuned for one message sent from the message table.
pub fn for_one_message(executor: &Executor) -> Executor {
    match executor {
        Executor::LocalLambda(target) => Executor::LocalLambda(LambdaTarget {
            timeout_secs: u32::try_from(SEND_ONE_TIMEOUT.as_secs()).unwrap_or(u32::MAX),
            concurrency: 1,
            ..target.clone()
        }),
    }
}
