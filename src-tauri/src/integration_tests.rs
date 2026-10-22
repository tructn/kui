//! End-to-end tests against a real broker. Not run by default.
//!
//!   docker compose up -d
//!   cargo test -- --ignored
//!
//! Override the broker with `KUI_TEST_BOOTSTRAP=host:port`.

use std::time::Duration;

use rdkafka::consumer::{CommitMode, Consumer};
use rdkafka::{Offset, TopicPartitionList};

use crate::features::consumer_groups::model::{ResetRequest, ResetTo};
use crate::features::generator::model::{GenerateRequest, HeaderTemplate, RecordTemplate};
use crate::features::messages::model::{
    BrowseRequest, CopyRequest, ExportFormat, ExportRequest, ExportSource, MessageRef, ProduceHeader, ProduceRequest,
    StartFrom, TailRequest,
};
use crate::features::topics::model::NewTopicRequest;
use crate::features::{brokers, clusters, consumer_groups, generator, messages, topics};
use crate::kafka::ClusterConfig;
use crate::kafka::{KafkaClients, new_consumer};
use crate::tasks::Tasks;

fn local_cluster() -> ClusterConfig {
    serde_json::from_value(serde_json::json!({
        "id": "test",
        "name": "test",
        "bootstrapServers": std::env::var("KUI_TEST_BOOTSTRAP").unwrap_or("localhost:9092".into()),
    }))
    .unwrap()
}

#[tokio::test]
#[ignore = "needs a running Kafka broker"]
async fn full_round_trip() {
    let cluster = local_cluster();
    assert!(clusters::service::test_connection(&cluster).unwrap() >= 1);
    let clients = KafkaClients::connect(cluster.clone()).unwrap();
    let topic = format!("kui-it-{}", uuid::Uuid::new_v4());

    // Create
    let request = NewTopicRequest {
        name: topic.clone(),
        partitions: 2,
        replication_factor: 1,
        configs: [("retention.ms".to_string(), "3600000".to_string())].into(),
    };
    topics::service::create(&clients, &request).await.unwrap();
    tokio::time::sleep(Duration::from_secs(1)).await;

    // Produce 10 messages to partition 0
    for i in 0..10 {
        let delivered = messages::service::produce(
            &clients,
            &ProduceRequest {
                topic: topic.clone(),
                partition: Some(0),
                key: Some(format!("k{i}")),
                value: Some(format!("{{\"n\":{i}}}")),
                headers: vec![ProduceHeader { key: "source".into(), value: "kui".into() }],
            },
        )
        .await
        .unwrap();
        assert_eq!(delivered.offset, i);
    }

    // List + detail
    let listed = topics::service::list_topics(&clients).unwrap();
    let summary = listed.iter().find(|t| t.name == topic).unwrap();
    assert_eq!((summary.partitions, summary.message_count), (2, 10));

    let parts = topics::service::partitions(&clients, &topic).unwrap();
    assert_eq!((parts[0].low, parts[0].high), (0, 10));
    let configs = topics::service::configs(&clients, &topic).await.unwrap();
    let retention = configs.iter().find(|c| c.name == "retention.ms").unwrap();
    assert_eq!(retention.value.as_deref(), Some("3600000"));

    // Browse
    let browse = |from, value, page_size| BrowseRequest {
        topic: topic.clone(),
        partition: None,
        from,
        value,
        page_size,
        cursor: None,
    };
    let offsets = |page: &messages::model::BrowsePage| page.messages.iter().map(|m| m.offset).collect::<Vec<_>>();
    let latest = messages::service::browse(&clients, &browse(StartFrom::Latest, None, 3)).unwrap();
    assert_eq!((offsets(&latest), latest.total), (vec![9, 8, 7], 10));
    assert_eq!(latest.messages[0].headers[0].value.as_deref(), Some("kui"));
    // The cursor continues where the page stopped, through to the last page.
    let second = BrowseRequest { cursor: latest.next.clone(), ..browse(StartFrom::Latest, None, 3) };
    let second = messages::service::browse(&clients, &second).unwrap();
    assert_eq!(offsets(&second), vec![6, 5, 4]);
    let rest = BrowseRequest { cursor: second.next.clone(), ..browse(StartFrom::Latest, None, 10) };
    let rest = messages::service::browse(&clients, &rest).unwrap();
    assert_eq!((offsets(&rest), rest.next), (vec![3, 2, 1, 0], None));

    let earliest = messages::service::browse(&clients, &browse(StartFrom::Earliest, None, 2)).unwrap();
    assert_eq!(earliest.messages[0].key.as_ref().unwrap().text, "k0");

    let from_offset = messages::service::browse(&clients, &browse(StartFrom::Offset, Some(5), 100)).unwrap();
    assert_eq!((from_offset.messages.len(), from_offset.total), (5, 5));

    let from_time = messages::service::browse(&clients, &browse(StartFrom::Timestamp, Some(0), 100)).unwrap();
    assert_eq!(from_time.messages.len(), 10);

    // Consumer group with a committed offset of 4 → lag 6
    let group = format!("kui-it-group-{}", uuid::Uuid::new_v4());
    {
        let committer = new_consumer(&cluster, &group).unwrap();
        let mut tpl = TopicPartitionList::new();
        tpl.add_partition_offset(&topic, 0, Offset::Offset(4)).unwrap();
        committer.commit(&tpl, CommitMode::Sync).unwrap();
    }
    let groups = consumer_groups::service::list(&clients).unwrap();
    assert!(groups.iter().any(|g| g.name == group));
    let detail = consumer_groups::service::detail(&clients, &group).unwrap();
    assert_eq!(detail.total_lag, 6);
    // Partition 1 was never committed: reported as untouched, not dropped.
    let progress = detail.topics.iter().find(|t| t.topic == topic).unwrap();
    assert_eq!((progress.partitions, progress.behind, progress.not_started), (2, 1, 1));
    assert_eq!((progress.consumed, progress.lag), (4, 6));

    let lags = consumer_groups::service::lags(&clients).unwrap();
    let lag = lags.iter().find(|g| g.name == group).unwrap();
    assert_eq!((lag.lag, lag.topics.clone()), (Some(6), vec![topic.clone()]));

    let consumers = consumer_groups::service::topic_consumers(&clients, &topic).unwrap();
    assert_eq!(consumers.iter().map(|c| c.group.as_str()).collect::<Vec<_>>(), vec![group.as_str()]);
    assert_eq!(consumers[0].offsets[0].committed, Some(4));
    consumer_groups::service::delete(&clients, &group).await.unwrap();

    // Overview
    let overview = brokers::service::cluster_overview(&clients).unwrap();
    assert!(!overview.brokers.is_empty() && overview.partition_count >= 2);

    // Delete; internal topics in the same batch are refused, the rest go ahead.
    let deleted = topics::service::delete(&clients, &["__consumer_offsets".into(), topic.clone()]).await.unwrap();
    let error_of = |name: &str| deleted.iter().find(|d| d.topic == name).unwrap().error.clone();
    assert!(error_of("__consumer_offsets").unwrap().contains("internal"));
    assert_eq!(error_of(&topic), None);
    assert!(topics::service::list_topics(&clients).unwrap().iter().any(|t| t.name == "__consumer_offsets"));
}

#[tokio::test]
#[ignore = "needs a running Kafka broker"]
async fn copy_messages() {
    use rdkafka::message::{Header, OwnedHeaders};
    use rdkafka::producer::FutureRecord;

    let clients = std::sync::Arc::new(KafkaClients::connect(local_cluster()).unwrap());
    let id = uuid::Uuid::new_v4();
    let (source, target) = (format!("kui-it-src-{id}"), format!("kui-it-dst-{id}"));
    for name in [&source, &target] {
        let request =
            NewTopicRequest { name: name.clone(), partitions: 1, replication_factor: 1, configs: Default::default() };
        topics::service::create(&clients, &request).await.unwrap();
    }
    tokio::time::sleep(Duration::from_secs(1)).await;

    // Binary value + header, so we can check bytes survive untouched.
    let value: &[u8] = &[0x00, 0xff, 0x10];
    for i in 0..3 {
        let record = FutureRecord::<str, [u8]>::to(&source)
            .key("k")
            .payload(value)
            .timestamp(1_000 + i)
            .headers(OwnedHeaders::new().insert(Header { key: "h", value: Some("v") }));
        clients.producer.send(record, Duration::from_secs(5)).await.unwrap();
    }

    let copy = |offsets: &[i64], target_topic: &str| CopyRequest {
        topic: source.clone(),
        messages: offsets.iter().map(|&offset| MessageRef { partition: 0, offset }).collect(),
        target_topic: target_topic.to_string(),
        target_partition: None,
    };
    let read_all = |topic: &str| {
        let request = BrowseRequest {
            topic: topic.to_string(),
            partition: None,
            from: StartFrom::Earliest,
            value: None,
            page_size: 100,
            cursor: None,
        };
        messages::service::browse(&clients, &request).unwrap().messages
    };

    // Duplicate within the same topic: appended last, stamped now, not with the original's time.
    let dup = messages::service::copy(clients.clone(), &copy(&[1], &source)).await.unwrap();
    assert_eq!(dup[0].offset, 3);
    let copied = read_all(&source).into_iter().find(|m| m.offset == 3).unwrap();
    assert!(copied.timestamp.unwrap() > 1_000_000_000_000, "{:?}", copied.timestamp);
    assert_eq!(copied.value.unwrap().text, "00 ff 10");
    assert_eq!(copied.headers[0].value.as_deref(), Some("v"));

    // Copying to another topic leaves the source untouched: nothing is ever deleted.
    let copied = messages::service::copy(clients.clone(), &copy(&[0], &target)).await.unwrap();
    assert_eq!(copied[0].offset, 0);
    assert_eq!(read_all(&target)[0].key.as_ref().unwrap().text, "k");
    let parts = topics::service::partitions(&clients, &source).unwrap();
    assert_eq!((parts[0].low, parts[0].high), (0, 4));

    // Several at once land in the order given.
    let batch = messages::service::copy(clients.clone(), &copy(&[0, 2], &target)).await.unwrap();
    assert_eq!(batch.iter().map(|d| d.offset).collect::<Vec<_>>(), [1, 2]);

    // An offset that doesn't exist is reported, not silently skipped, and nothing is written.
    let gone = messages::service::copy(clients.clone(), &copy(&[1, 99], &target)).await;
    assert!(gone.unwrap_err().to_string().contains("no longer exists"));
    assert_eq!(read_all(&target).len(), 3);

    // Both topics in one batch; each reports its own outcome.
    let deleted = topics::service::delete(&clients, &[source.clone(), target.clone()]).await.unwrap();
    assert_eq!(deleted.len(), 2);
    assert!(deleted.iter().all(|d| d.error.is_none()));
}

#[tokio::test]
#[ignore = "needs a running Kafka broker"]
async fn live_tail_sees_generated_records() {
    let clients = std::sync::Arc::new(KafkaClients::connect(local_cluster()).unwrap());
    let topic = format!("kui-it-gen-{}", uuid::Uuid::new_v4());
    let request =
        NewTopicRequest { name: topic.clone(), partitions: 3, replication_factor: 1, configs: Default::default() };
    topics::service::create(&clients, &request).await.unwrap();
    tokio::time::sleep(Duration::from_secs(1)).await;

    // Start tailing on a background thread, like the `tail_messages` command does.
    let tasks = std::sync::Arc::new(Tasks::default());
    let tail_cancel = tasks.start("tail");
    let (tail_clients, tail_topic) = (clients.clone(), topic.clone());
    let tail = std::thread::spawn(move || {
        let mut seen = Vec::new();
        let request = TailRequest { topic: tail_topic, partition: None };
        messages::service::tail(&tail_clients, &request, &tail_cancel, |batch| {
            seen.extend(batch);
            true
        })
        .unwrap();
        seen
    });
    tokio::time::sleep(Duration::from_secs(2)).await; // let the tail get assigned

    let mut updates = 0;
    let request = GenerateRequest {
        topic: topic.clone(),
        partition: None,
        template: RecordTemplate {
            key: Some("user-{{seq}}".into()),
            value: r#"{"id": {{seq}}, "name": "{{name}}"}"#.into(),
            headers: vec![HeaderTemplate { key: "source".into(), value: "kui-{{int 1 9}}".into() }],
            locale: Default::default(),
        },
        count: 50,
        rate: Some(100),
    };
    let done = generator::service::generate(&clients, &request, &crate::tasks::CancelToken::never(), |_| updates += 1)
        .await
        .unwrap();
    assert_eq!((done.sent, done.failed), (50, 0));
    assert!(updates > 1, "throttled runs report progress more than once");
    assert!(done.elapsed_ms >= 400, "100/s for 50 records takes ~0.5s, took {}ms", done.elapsed_ms);

    tokio::time::sleep(Duration::from_secs(2)).await;
    tasks.cancel("tail");
    let seen = tail.join().unwrap();
    assert_eq!(seen.len(), 50);
    let first = seen.iter().find(|m| m.key.as_ref().unwrap().text == "user-1").unwrap();
    let value: serde_json::Value = serde_json::from_str(&first.value.as_ref().unwrap().text).unwrap();
    assert_eq!(value["id"], 1);
    assert!(first.headers[0].value.as_deref().unwrap().starts_with("kui-"));

    topics::service::delete(&clients, std::slice::from_ref(&topic)).await.unwrap();
}

#[tokio::test]
#[ignore = "needs a running Kafka broker"]
async fn export_messages() {
    use rdkafka::producer::FutureRecord;

    let clients = KafkaClients::connect(local_cluster()).unwrap();
    let topic = format!("kui-it-export-{}", uuid::Uuid::new_v4());
    let request =
        NewTopicRequest { name: topic.clone(), partitions: 2, replication_factor: 1, configs: Default::default() };
    topics::service::create(&clients, &request).await.unwrap();
    tokio::time::sleep(Duration::from_secs(1)).await;

    // More than one page (1,000) in total, so a range export has to continue.
    for i in 0..1500 {
        let value = format!("{{\"n\":{i}}}");
        let record = FutureRecord::<str, str>::to(&topic).partition(i % 2).key("k").payload(&value);
        clients.producer.send(record, Duration::from_secs(5)).await.unwrap();
    }

    let range = |limit, format| ExportRequest {
        source: ExportSource::Range {
            browse: BrowseRequest {
                topic: topic.clone(),
                partition: None,
                from: StartFrom::Earliest,
                value: None,
                page_size: 50,
                cursor: None,
            },
            limit,
        },
        format,
    };
    let export = |request: &ExportRequest| {
        let mut out = Vec::new();
        let count = messages::service::export(&clients, request, &mut out).unwrap();
        (count, String::from_utf8(out).unwrap())
    };

    let (count, ndjson) = export(&range(1200, ExportFormat::Ndjson));
    assert_eq!((count, ndjson.lines().count()), (1200, 1200));
    // No message is written twice across pages.
    let mut seen: Vec<(i64, i64)> = ndjson
        .lines()
        .map(|l| serde_json::from_str::<serde_json::Value>(l).unwrap())
        .map(|v| (v["partition"].as_i64().unwrap(), v["offset"].as_i64().unwrap()))
        .collect();
    seen.sort_unstable();
    seen.dedup();
    assert_eq!(seen.len(), 1200);

    // A limit above what is there stops at the end of the topic.
    let (count, json) = export(&range(5000, ExportFormat::Json));
    assert_eq!(count, 1500);
    assert_eq!(serde_json::from_str::<serde_json::Value>(&json).unwrap().as_array().unwrap().len(), 1500);

    // Selected messages, in partition and offset order, as CSV.
    let picked = ExportRequest {
        source: ExportSource::Messages {
            topic: topic.clone(),
            messages: vec![MessageRef { partition: 1, offset: 0 }, MessageRef { partition: 0, offset: 2 }],
        },
        format: ExportFormat::Csv,
    };
    let (count, csv) = export(&picked);
    assert_eq!(count, 2);
    let rows: Vec<&str> = csv.lines().skip(1).collect();
    assert!(rows[0].starts_with(&format!("{topic},0,2,")), "{}", rows[0]);
    assert!(rows[1].contains("\"{\"\"n\"\":1}\""), "{}", rows[1]);

    // To a file: the finished file appears, the temporary one doesn't stay.
    let path = std::env::temp_dir().join(format!("{topic}.json"));
    assert_eq!(messages::service::export_to_file(&clients, &range(10, ExportFormat::Json), &path).unwrap(), 10);
    assert!(path.exists() && !path.with_extension("json.part").exists());
    std::fs::remove_file(&path).unwrap();

    topics::service::delete(&clients, &[topic]).await.unwrap();
}

#[tokio::test]
#[ignore = "needs a running Kafka broker"]
async fn reset_consumer_group_offsets() {
    use rdkafka::producer::FutureRecord;

    let cluster = local_cluster();
    let clients = KafkaClients::connect(cluster.clone()).unwrap();
    let id = uuid::Uuid::new_v4();
    let (topic, group) = (format!("kui-it-reset-{id}"), format!("kui-it-reset-group-{id}"));
    let request =
        NewTopicRequest { name: topic.clone(), partitions: 2, replication_factor: 1, configs: Default::default() };
    topics::service::create(&clients, &request).await.unwrap();
    tokio::time::sleep(Duration::from_secs(1)).await;

    // Partition 0 gets 10 messages stamped 1000..1009; partition 1 stays empty.
    for i in 0..10 {
        let record = FutureRecord::<str, str>::to(&topic).partition(0).payload("x").timestamp(1_000 + i);
        clients.producer.send(record, Duration::from_secs(5)).await.unwrap();
    }
    {
        let committer = new_consumer(&cluster, &group).unwrap();
        let mut tpl = TopicPartitionList::new();
        tpl.add_partition_offset(&topic, 0, Offset::Offset(4)).unwrap();
        committer.commit(&tpl, CommitMode::Sync).unwrap();
    }
    let reset =
        |to, partitions: Option<Vec<i32>>| ResetRequest { group: group.clone(), topic: topic.clone(), partitions, to };
    let committed_on_0 = || {
        let detail = consumer_groups::service::detail(&clients, &group).unwrap();
        detail.offsets.iter().find(|o| o.partition == 0).unwrap().committed
    };

    // A preview changes nothing.
    let plan = consumer_groups::service::plan_reset(&clients, &reset(ResetTo::Earliest, None)).unwrap();
    assert_eq!(
        plan.iter().map(|c| (c.partition, c.current, c.target)).collect::<Vec<_>>(),
        [(0, Some(4), 0), (1, None, 0)]
    );
    assert_eq!(committed_on_0(), Some(4));

    // Replay from a point in time.
    let changed =
        consumer_groups::service::reset_offsets(&clients, &reset(ResetTo::Timestamp { value: 1_006 }, Some(vec![0])))
            .unwrap();
    assert_eq!(changed.iter().map(|c| c.target).collect::<Vec<_>>(), [6]);
    assert_eq!(committed_on_0(), Some(6));

    // Earliest, an offset past the end (kept at the end), latest.
    for (to, expected) in [(ResetTo::Earliest, 0), (ResetTo::Offset { value: 99 }, 10), (ResetTo::Latest, 10)] {
        consumer_groups::service::reset_offsets(&clients, &reset(to, None)).unwrap();
        assert_eq!(committed_on_0(), Some(expected), "{to:?}");
    }

    // Refused while a consumer is connected to the group.
    let member = new_consumer(&cluster, &group).unwrap();
    member.subscribe(&[&topic]).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    while member.assignment().unwrap().count() == 0 && std::time::Instant::now() < deadline {
        member.poll(Duration::from_millis(200));
    }
    let refused = consumer_groups::service::reset_offsets(&clients, &reset(ResetTo::Earliest, None));
    assert!(refused.unwrap_err().to_string().contains("active member"));
    drop(member);

    consumer_groups::service::delete(&clients, &group).await.ok();
    topics::service::delete(&clients, &[topic]).await.unwrap();
}
