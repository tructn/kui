use std::time::{Duration, Instant};

use super::body::body;
use super::log::{Finished, RunLog, now_ms};
use super::plan::{Outcome, Plan};
use crate::model::ExecutionDetail;
use crate::record::Record;
use crate::{Error, Result};

const CANCEL_POLL: Duration = Duration::from_millis(100);

/// Sends one record through `plan` and records it in `log`'s history, like a
/// run would, but with no group and no commit. Cancelling drops the request
/// and records nothing, so the history only shows answers.
pub async fn send_one(
    record: Record,
    plan: &Plan,
    log: &RunLog,
    is_cancelled: impl Fn() -> bool,
) -> Result<ExecutionDetail> {
    let started_at = now_ms();
    let started = Instant::now();
    let (request, outcome) = match (plan.build)(&record) {
        Err(error) => (None, Outcome::failed(error)),
        Ok(payload) => {
            let request = Some(body(&payload));
            // Spawned so it can be dropped mid-flight when the user stops waiting.
            let mut invocation = tokio::spawn((plan.invoke)(payload));
            let outcome = loop {
                if is_cancelled() {
                    invocation.abort();
                    return Err(Error::msg(format!("Stopped waiting for {}", plan.target)));
                }
                match tokio::time::timeout(CANCEL_POLL, &mut invocation).await {
                    Err(_) => continue,
                    Ok(Ok(outcome)) => break outcome,
                    Ok(Err(e)) => break Outcome::failed(format!("The invocation stopped unexpectedly: {e}")),
                }
            };
            (request, outcome)
        }
    };
    log.set_in_flight(0);
    let id = log.record(&plan.target, Finished { record, request, outcome, started_at, elapsed: started.elapsed() });
    log.detail(id).ok_or_else(|| Error::msg("The execution was dropped from the history"))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::*;
    use crate::model::ExecutionStatus;
    use crate::run::plan::Invocation;

    fn plan(invoke: impl Fn(Vec<u8>) -> Invocation + Send + Sync + 'static) -> Plan {
        Plan {
            target: "Fn".into(),
            concurrency: 1,
            stop_grace: Duration::ZERO,
            build: Box::new(|_| Ok(b"{}".to_vec())),
            invoke: Arc::new(invoke),
            stop_on_retryable: true,
        }
    }

    fn answered(status: ExecutionStatus) -> Invocation {
        Box::pin(async move { Outcome { status, response: Some(b"ok".to_vec()), error: None, retryable: false } })
    }

    #[tokio::test]
    async fn the_answer_lands_in_the_history_with_its_bodies() {
        let log = RunLog::new("a");
        let plan = plan(|_| answered(ExecutionStatus::Succeeded));
        let detail = send_one(Record::sample(2, 41), &plan, &log, || false).await.unwrap();
        assert_eq!((detail.summary.partition, detail.summary.offset), (2, 41));
        assert_eq!(detail.summary.status, ExecutionStatus::Succeeded);
        assert_eq!(detail.request.unwrap().text, "{}");
        assert_eq!(detail.response.unwrap().text, "ok");
        assert_eq!(log.summaries().len(), 1);
        assert_eq!(log.status().processed, 1);
    }

    #[tokio::test]
    async fn a_payload_that_cant_be_built_is_recorded_as_failed_without_a_request() {
        let log = RunLog::new("a");
        let mut plan = plan(|_| answered(ExecutionStatus::Succeeded));
        plan.build = Box::new(|_| Err("Value is not JSON".into()));
        let detail = send_one(Record::sample(0, 0), &plan, &log, || false).await.unwrap();
        assert_eq!(detail.summary.status, ExecutionStatus::Failed);
        assert!(detail.request.is_none());
    }

    #[tokio::test]
    async fn cancelling_stops_waiting_and_records_nothing() {
        let log = RunLog::new("a");
        let plan = plan(|_| Box::pin(std::future::pending()));
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = cancelled.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(150)).await;
            flag.store(true, Ordering::Relaxed);
        });
        let result = send_one(Record::sample(0, 0), &plan, &log, || cancelled.load(Ordering::Relaxed)).await;
        assert!(result.is_err());
        assert!(log.summaries().is_empty());
    }
}
