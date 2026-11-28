//! Runs an Action against a real broker with a fake executor. Not run by default:
//!
//!   bun run kafka:up
//!   cargo test -p kui_actions -- --ignored
//!
//! Override the broker with `KUI_TEST_BOOTSTRAP=host:port`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rdkafka::admin::{AdminClient, NewTopic, TopicReplication};
use rdkafka::client::DefaultClientContext;
use rdkafka::producer::{BaseProducer, BaseRecord, Producer};

use kui_actions::model::{ExecutionStatus, RunState, Source, StartFrom};
use kui_actions::run::{self, Invocation, Outcome, Plan, RunLog};
use kui_actions::{Record, kafka};
use kui_kafka::{ClusterConfig, admin_options, client_config};

fn cluster() -> ClusterConfig {
    serde_json::from_value(serde_json::json!({
        "id": "test",
        "name": "test",
        "bootstrapServers": std::env::var("KUI_TEST_BOOTSTRAP").unwrap_or("localhost:9092".into()),
    }))
    .unwrap()
}

fn produce(cluster: &ClusterConfig, topic: &str, range: std::ops::Range<i32>) {
    let producer: BaseProducer = client_config(cluster).create().unwrap();
    for i in range {
        let value = format!("{{\"n\":{i}}}");
        producer.send(BaseRecord::<(), _>::to(topic).partition(i % 2).payload(&value)).unwrap();
    }
    producer.flush(Duration::from_secs(10)).unwrap();
}

type Calls = Arc<Mutex<Vec<(i32, i64)>>>;

/// Records which (partition, offset) each invocation was for; offset 3 throws.
fn fake_plan(calls: Calls) -> Plan {
    Plan {
        target: "Fake".into(),
        concurrency: 2,
        stop_grace: Duration::from_secs(5),
        build: Box::new(|r: &Record| Ok(format!("[{},{}]", r.partition, r.offset).into_bytes())),
        invoke: Arc::new(move |payload| -> Invocation {
            let calls = calls.clone();
            Box::pin(async move {
                tokio::time::sleep(Duration::from_millis(20)).await;
                let (p, o): (i32, i64) = serde_json::from_slice(&payload).unwrap();
                calls.lock().unwrap().push((p, o));
                let status = if o == 3 { ExecutionStatus::FunctionError } else { ExecutionStatus::Succeeded };
                Outcome { status, response: Some(b"{}".to_vec()), error: None, retryable: false }
            })
        }),
        stop_on_retryable: false,
    }
}

/// Runs until `processed` executions are recorded, then stops.
fn run_until(cluster: &ClusterConfig, source: &Source, log: &Arc<RunLog>, calls: &Calls, processed: u64) {
    log.begin().unwrap();
    let consumer = kafka::subscribe(cluster, source).unwrap();
    let plan = fake_plan(calls.clone());
    let stop = Arc::new(AtomicBool::new(false));
    let runtime = tokio::runtime::Handle::current();
    let (thread_log, thread_stop) = (log.clone(), stop.clone());
    let thread = std::thread::spawn(move || {
        let result = run::run(&consumer, &plan, &thread_log, &runtime, || thread_stop.load(Ordering::Relaxed));
        drop(consumer);
        thread_log.finish(result);
    });
    let deadline = Instant::now() + Duration::from_secs(60);
    while log.status().processed < processed {
        assert!(Instant::now() < deadline, "timed out after {} executions", log.status().processed);
        std::thread::sleep(Duration::from_millis(50));
    }
    stop.store(true, Ordering::Relaxed);
    thread.join().unwrap();
    assert_eq!(log.status().state, RunState::Stopped);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a running Kafka broker"]
async fn invokes_each_message_once_in_partition_order_and_resumes() {
    let cluster = cluster();
    let topic = format!("kui-action-it-{}", std::process::id());
    let admin: AdminClient<DefaultClientContext> = client_config(&cluster).create().unwrap();
    admin.create_topics(&[NewTopic::new(&topic, 2, TopicReplication::Fixed(1))], &admin_options()).await.unwrap();
    produce(&cluster, &topic, 0..10);

    let source = Source { topic: topic.clone(), group_id: format!("{topic}-group"), start_from: StartFrom::Earliest };
    let log = Arc::new(RunLog::new("it"));
    let calls: Calls = Arc::default();

    let probe_cluster = cluster.clone();
    let probe_source = source.clone();
    let (log1, calls1) = (log.clone(), calls.clone());
    tokio::task::spawn_blocking(move || run_until(&probe_cluster, &probe_source, &log1, &calls1, 10)).await.unwrap();

    let first = calls.lock().unwrap().clone();
    assert_eq!(first.len(), 10, "every message once: {first:?}");
    for partition in [0, 1] {
        let offsets: Vec<i64> = first.iter().filter(|(p, _)| *p == partition).map(|(_, o)| *o).collect();
        assert_eq!(offsets, (0..5).collect::<Vec<_>>(), "partition {partition} in order");
    }
    // Offset 3 exists on both partitions and throws on each.
    assert_eq!(log.status().failed, 2);

    // Committed on stop, so a new run picks up only the new messages.
    produce(&cluster, &topic, 10..14);
    calls.lock().unwrap().clear();
    let (log2, calls2) = (log.clone(), calls.clone());
    tokio::task::spawn_blocking(move || run_until(&cluster, &source, &log2, &calls2, 4)).await.unwrap();
    let mut second = calls.lock().unwrap().clone();
    second.sort_unstable();
    assert_eq!(second, vec![(0, 5), (0, 6), (1, 5), (1, 6)]);

    admin.delete_topics(&[&topic], &admin_options()).await.unwrap();
}
