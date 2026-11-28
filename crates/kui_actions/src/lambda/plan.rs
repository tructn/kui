use std::sync::Arc;
use std::time::Duration;

use kui_kafka::ClusterConfig;

use super::{Call, check_endpoint, client, invocation_url, invoke};
use crate::model::{EndpointCheck, LambdaTarget};
use crate::payload::{self, Origin};
use crate::run::{Invocation, Plan};
use crate::{Error, Result, validate};

/// Slack past the invocation timeout, so a result that just made it still arrives on Stop.
const STOP_SLACK: Duration = Duration::from_secs(2);
/// The longest Stop waits for answers. A function paused at a breakpoint would
/// otherwise hold Stop for the whole timeout; its message isn't committed, so
/// it runs again on the next Start.
const MAX_STOP_WAIT: Duration = Duration::from_secs(10);

/// Fails Start with advice instead of filling history with "not running" rows.
pub async fn check_target(target: &LambdaTarget) -> Result<()> {
    let endpoint = validate::endpoint(&target.endpoint)?;
    match check_endpoint(&client()?, &endpoint, target.runtime).await {
        EndpointCheck::Ready => Ok(()),
        EndpointCheck::NotRunning { message } | EndpointCheck::Unexpected { message } => Err(Error::msg(message)),
    }
}

pub fn plan(target: &LambdaTarget, cluster: &ClusterConfig) -> Result<Plan> {
    let endpoint = validate::endpoint(&target.endpoint)?;
    let client = client()?;
    let timeout = Duration::from_secs(target.timeout_secs.into());
    let call = Call {
        runtime: target.runtime,
        url: invocation_url(&endpoint, &target.function_name)?,
        function: target.function_name.clone(),
        timeout,
    };
    let cluster_id = cluster.id.clone();
    let bootstrap_servers = cluster.bootstrap_servers.clone();
    Ok(Plan {
        target: target.function_name.clone(),
        concurrency: target.concurrency.into(),
        stop_grace: timeout.min(MAX_STOP_WAIT) + STOP_SLACK,
        build: Box::new(move |record| {
            Ok(payload::build(record, &Origin { cluster_id: &cluster_id, bootstrap_servers: &bootstrap_servers }))
        }),
        invoke: Arc::new(move |payload| -> Invocation {
            let (client, call) = (client.clone(), call.clone());
            Box::pin(async move { invoke(&client, &call, payload).await })
        }),
        stop_on_retryable: false,
    })
}
