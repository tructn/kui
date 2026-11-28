use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use tokio::runtime::Handle;

use super::body::body;
use super::log::{Finished, RunLog, now_ms};
use super::plan::{Outcome, Plan};
use super::scheduler::Scheduler;
use super::source::{CommitMode, MessageSource};
use crate::model::RunState;
use crate::record::Record;
use crate::{Error, Result};

const POLL: Duration = Duration::from_millis(50);

/// Runs until `is_cancelled` returns true or consuming fails. The source must
/// already be subscribed. Invocations run on `runtime`; this thread only
/// polls, so call it from a dedicated thread.
pub fn run<S: MessageSource + ?Sized>(
    source: &S,
    plan: &Plan,
    log: &RunLog,
    runtime: &Handle,
    is_cancelled: impl Fn() -> bool,
) -> Result<()> {
    log.set_state(RunState::Running);
    let mut runner = Runner::new(source, plan, log, runtime);
    let result = runner.consume(is_cancelled);
    log.set_state(RunState::Stopping);
    runner.drain(Instant::now() + plan.stop_grace);
    runner.commit(CommitMode::Sync);
    result
}

struct Runner<'a, S: ?Sized> {
    source: &'a S,
    plan: &'a Plan,
    log: &'a RunLog,
    runtime: &'a Handle,
    tx: Sender<Finished>,
    rx: Receiver<Finished>,
    scheduler: Scheduler,
    paused: bool,
    /// Why the run stopped itself, under `Plan::stop_on_retryable`.
    halted: Option<String>,
}

impl<'a, S: MessageSource + ?Sized> Runner<'a, S> {
    fn new(source: &'a S, plan: &'a Plan, log: &'a RunLog, runtime: &'a Handle) -> Self {
        let (tx, rx) = mpsc::channel();
        let scheduler = Scheduler::new(plan.concurrency);
        Runner { source, plan, log, runtime, tx, rx, scheduler, paused: false, halted: None }
    }

    fn consume(&mut self, is_cancelled: impl Fn() -> bool) -> Result<()> {
        loop {
            if is_cancelled() {
                return Ok(());
            }
            self.collect();
            if let Some(reason) = self.halted.take() {
                return Err(Error::Msg(reason));
            }
            self.dispatch();
            self.throttle();
            match self.source.poll(POLL) {
                None => {}
                Some(Ok(record)) => self.scheduler.push(record),
                Some(Err(e)) => return Err(e),
            }
        }
    }

    /// Waits up to `deadline` for the invocations still running.
    fn drain(&mut self, deadline: Instant) {
        while self.scheduler.in_flight() > 0 && Instant::now() < deadline {
            if let Ok(done) = self.rx.recv_timeout(POLL) {
                self.complete(done);
            }
        }
    }

    fn collect(&mut self) {
        let finished: Vec<Finished> = self.rx.try_iter().collect();
        if finished.is_empty() {
            return;
        }
        for done in finished {
            self.complete(done);
        }
        self.commit(CommitMode::Async);
    }

    fn complete(&mut self, done: Finished) {
        if self.plan.stop_on_retryable && done.outcome.retryable {
            self.scheduler.abandon(&done.record);
            if self.halted.is_none() {
                self.halted = Some(halt_reason(&done));
            }
        } else {
            self.scheduler.finish(&done.record);
        }
        self.log.record(&self.plan.target, done);
        self.log.set_in_flight(self.scheduler.in_flight());
    }

    fn dispatch(&mut self) {
        for record in self.scheduler.take_ready() {
            self.start(record);
        }
        self.log.set_in_flight(self.scheduler.in_flight());
    }

    fn start(&self, record: Record) {
        let started_at = now_ms();
        let started = Instant::now();
        match (self.plan.build)(&record) {
            // Reported like any failed invocation, so it's committed in order.
            Err(error) => {
                let outcome = Outcome::failed(error);
                let _ =
                    self.tx.send(Finished { record, request: None, outcome, started_at, elapsed: started.elapsed() });
            }
            Ok(payload) => {
                let request = Some(body(&payload));
                let invocation = (self.plan.invoke)(payload);
                let tx = self.tx.clone();
                self.runtime.spawn(async move {
                    let outcome = invocation.await;
                    let _ = tx.send(Finished { record, request, outcome, started_at, elapsed: started.elapsed() });
                });
            }
        }
    }

    /// Pauses fetching while enough messages are waiting, so a slow function
    /// slows the Action down instead of filling memory.
    fn throttle(&mut self) {
        let full = self.scheduler.is_full();
        if full != self.paused && self.source.set_paused(full).is_ok() {
            self.paused = full;
        }
    }

    fn commit(&mut self, mode: CommitMode) {
        let offsets = self.scheduler.take_commits();
        if offsets.is_empty() {
            return;
        }
        // A commit for a partition lost in a rebalance fails; its new owner
        // re-runs those messages, as at-least-once allows.
        let _ = self.source.commit(&offsets, mode);
    }
}

fn halt_reason(done: &Finished) -> String {
    let error = done.outcome.error.as_deref().unwrap_or("No answer");
    format!(
        "Stopped at partition {} offset {} and kept it uncommitted, so Start sends it again. {error}",
        done.record.partition, done.record.offset
    )
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, VecDeque};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::Error;
    use crate::model::ExecutionStatus;
    use crate::run::plan::Invocation;
    use crate::run::scheduler::BUFFER_LIMIT;
    use crate::run::source::NextOffsets;

    /// Hands out scripted records (nothing while paused) and records what the runner asked of it.
    #[derive(Default)]
    struct FakeSource {
        pending: Mutex<VecDeque<Result<Record>>>,
        paused: Mutex<bool>,
        pauses: Mutex<Vec<bool>>,
        commits: Mutex<Vec<(NextOffsets, CommitMode)>>,
    }

    impl FakeSource {
        fn with(items: impl IntoIterator<Item = Result<Record>>) -> Self {
            FakeSource { pending: Mutex::new(items.into_iter().collect()), ..Default::default() }
        }

        fn records(partitions: i32, per_partition: i64) -> Self {
            Self::with((0..per_partition).flat_map(|o| (0..partitions).map(move |p| Ok(Record::sample(p, o)))))
        }

        /// The last committed offset per partition.
        fn committed(&self) -> HashMap<i32, i64> {
            let commits = self.commits.lock().unwrap();
            commits.iter().flat_map(|(offsets, _)| offsets.iter().map(|((_, p), next)| (*p, *next))).collect()
        }
    }

    impl MessageSource for FakeSource {
        fn poll(&self, _timeout: Duration) -> Option<Result<Record>> {
            let next = if *self.paused.lock().unwrap() { None } else { self.pending.lock().unwrap().pop_front() };
            if next.is_none() {
                std::thread::sleep(Duration::from_millis(1));
            }
            next
        }

        fn set_paused(&self, paused: bool) -> Result<()> {
            *self.paused.lock().unwrap() = paused;
            self.pauses.lock().unwrap().push(paused);
            Ok(())
        }

        fn commit(&self, offsets: &NextOffsets, mode: CommitMode) -> Result<()> {
            self.commits.lock().unwrap().push((offsets.clone(), mode));
            Ok(())
        }
    }

    type Calls = Arc<Mutex<Vec<(i32, i64)>>>;

    /// The payload is `[partition, offset]`; each invocation is logged in `calls`.
    fn plan(concurrency: usize, delay: Duration, calls: Calls, peak: Arc<AtomicUsize>) -> Plan {
        let running = Arc::new(AtomicUsize::new(0));
        Plan {
            target: "Fake".into(),
            concurrency,
            stop_grace: Duration::from_secs(5),
            build: Box::new(|r: &Record| Ok(serde_json::to_vec(&(r.partition, r.offset)).unwrap())),
            invoke: Arc::new(move |payload| -> Invocation {
                let (calls, peak, running) = (calls.clone(), peak.clone(), running.clone());
                Box::pin(async move {
                    let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(now, Ordering::SeqCst);
                    tokio::time::sleep(delay).await;
                    calls.lock().unwrap().push(serde_json::from_slice(&payload).unwrap());
                    running.fetch_sub(1, Ordering::SeqCst);
                    Outcome { status: ExecutionStatus::Succeeded, response: None, error: None, retryable: false }
                })
            }),
            stop_on_retryable: false,
        }
    }

    /// Offset 2 gets no answer; everything else succeeds.
    fn plan_without_an_answer_at_2(stop_on_retryable: bool, calls: Calls) -> Plan {
        let mut plan = plan(1, Duration::ZERO, Calls::default(), Arc::default());
        plan.stop_on_retryable = stop_on_retryable;
        plan.invoke = Arc::new(move |payload| -> Invocation {
            let calls = calls.clone();
            Box::pin(async move {
                let (p, o): (i32, i64) = serde_json::from_slice(&payload).unwrap();
                calls.lock().unwrap().push((p, o));
                match o {
                    2 => Outcome::unanswered(ExecutionStatus::TimedOut, "No response within 1s"),
                    _ => Outcome { status: ExecutionStatus::Succeeded, response: None, error: None, retryable: false },
                }
            })
        });
        plan
    }

    /// Runs until `processed` executions are recorded (or the source fails).
    fn run_until(source: &FakeSource, plan: &Plan, processed: u64) -> (Result<()>, RunLog) {
        let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_time().build().unwrap();
        let log = RunLog::new("a");
        let deadline = Instant::now() + Duration::from_secs(20);
        let result = run(source, plan, &log, runtime.handle(), || {
            assert!(Instant::now() < deadline, "timed out after {} executions", log.status().processed);
            log.status().processed >= processed
        });
        (result, log)
    }

    #[test]
    fn invokes_each_record_once_in_partition_order_and_commits_after() {
        let source = FakeSource::records(2, 5);
        let calls = Calls::default();
        let plan = plan(2, Duration::from_millis(2), calls.clone(), Arc::default());
        let (result, log) = run_until(&source, &plan, 10);
        assert!(result.is_ok());
        assert_eq!(log.status().state, RunState::Stopping, "the caller reports Stopped");
        let calls = calls.lock().unwrap();
        for partition in [0, 1] {
            let offsets: Vec<i64> = calls.iter().filter(|(p, _)| *p == partition).map(|(_, o)| *o).collect();
            assert_eq!(offsets, [0, 1, 2, 3, 4], "partition {partition}");
        }
        assert_eq!(source.committed(), HashMap::from([(0, 5), (1, 5)]));
    }

    #[test]
    fn never_runs_two_records_of_one_partition_at_once() {
        let source = FakeSource::records(1, 6);
        let peak = Arc::new(AtomicUsize::new(0));
        let plan = plan(4, Duration::from_millis(10), Calls::default(), peak.clone());
        run_until(&source, &plan, 6).0.unwrap();
        assert_eq!(peak.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn unbuildable_records_fail_without_an_invocation_and_are_still_committed() {
        let source = FakeSource::records(1, 3);
        let calls = Calls::default();
        let mut plan = plan(1, Duration::ZERO, calls.clone(), Arc::default());
        plan.build = Box::new(|r: &Record| match r.offset {
            1 => Err("not JSON".into()),
            _ => Ok(serde_json::to_vec(&(r.partition, r.offset)).unwrap()),
        });
        let (_, log) = run_until(&source, &plan, 3);
        assert_eq!(*calls.lock().unwrap(), [(0, 0), (0, 2)]);
        let failed = log.summaries().into_iter().find(|s| s.offset == 1).unwrap();
        assert_eq!(failed.status, ExecutionStatus::Failed);
        assert_eq!(failed.error.as_deref(), Some("not JSON"));
        assert_eq!(log.status().failed, 1);
        assert_eq!(source.committed(), HashMap::from([(0, 3)]));
    }

    #[test]
    fn a_source_error_waits_for_running_work_and_commits_only_what_ran() {
        let source =
            FakeSource::with([Ok(Record::sample(0, 0)), Ok(Record::sample(0, 1)), Err(Error::msg("broker gone"))]);
        let plan = plan(1, Duration::from_millis(50), Calls::default(), Arc::default());
        let (result, log) = run_until(&source, &plan, u64::MAX);
        assert_eq!(result.unwrap_err().to_string(), "broker gone");
        assert_eq!(log.status().processed, 1, "offset 1 was fetched but never started");
        let commits = source.commits.lock().unwrap();
        assert_eq!(*commits, [(HashMap::from([(("t".to_string(), 0), 1)]), CommitMode::Sync)]);
    }

    #[test]
    fn debugging_stops_at_an_unanswered_message_and_leaves_it_uncommitted() {
        let source = FakeSource::records(1, 5);
        let calls = Calls::default();
        let plan = plan_without_an_answer_at_2(true, calls.clone());
        let (result, log) = run_until(&source, &plan, u64::MAX);
        let message = result.unwrap_err().to_string();
        assert!(message.contains("partition 0 offset 2") && message.contains("No response within 1s"), "{message}");
        assert_eq!(*calls.lock().unwrap(), [(0, 0), (0, 1), (0, 2)], "nothing after it starts");
        assert_eq!(source.committed(), HashMap::from([(0, 2)]), "the next start resumes at offset 2");
        assert_eq!(log.summaries()[0].status, ExecutionStatus::TimedOut, "it still shows in history");
    }

    #[test]
    fn without_debugging_an_unanswered_message_is_skipped() {
        let source = FakeSource::records(1, 5);
        let plan = plan_without_an_answer_at_2(false, Calls::default());
        let (result, _) = run_until(&source, &plan, 5);
        assert!(result.is_ok());
        assert_eq!(source.committed(), HashMap::from([(0, 5)]));
    }

    #[test]
    fn debugging_still_commits_handled_errors() {
        let source = FakeSource::records(1, 3);
        let mut plan = plan(1, Duration::ZERO, Calls::default(), Arc::default());
        plan.stop_on_retryable = true;
        plan.invoke = Arc::new(|_| -> Invocation {
            Box::pin(async {
                Outcome { status: ExecutionStatus::FunctionError, response: None, error: None, retryable: false }
            })
        });
        let (result, _) = run_until(&source, &plan, 3);
        assert!(result.is_ok(), "the handler ran, so the developer already saw it");
        assert_eq!(source.committed(), HashMap::from([(0, 3)]));
    }

    #[test]
    fn pauses_fetching_while_the_buffer_is_full() {
        let total = BUFFER_LIMIT as i64 + 20;
        let source = FakeSource::records(1, total);
        let plan = plan(1, Duration::ZERO, Calls::default(), Arc::default());
        run_until(&source, &plan, total as u64).0.unwrap();
        let pauses = source.pauses.lock().unwrap();
        assert_eq!(pauses[..2], [true, false], "{pauses:?}");
        assert_eq!(source.committed(), HashMap::from([(0, total)]));
    }
}
