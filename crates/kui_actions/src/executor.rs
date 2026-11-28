//! Turns a saved Action's executor into the plan its run uses. A new executor
//! is a new `Executor` variant with its own module; these `match`es are the
//! only places it plugs in.

use kui_kafka::ClusterConfig;

use crate::model::{Action, Executor};
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
