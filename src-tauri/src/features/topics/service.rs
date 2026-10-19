use rdkafka::admin::{NewTopic, ResourceSpecifier, TopicReplication};

use super::model::{DeleteTopicResult, NewTopicRequest, Partition, TopicConfigEntry, TopicSummary};
use crate::error::{Error, Result};
use crate::kafka::metadata::{fetch_metadata, is_internal, single_topic};
use crate::kafka::offsets::{PartitionKey, watermarks};
use crate::kafka::{KafkaClients, admin_options};

pub fn list_topics(clients: &KafkaClients) -> Result<Vec<TopicSummary>> {
    let md = fetch_metadata(clients, None)?;
    let all_partitions: Vec<PartitionKey> =
        md.topics().iter().flat_map(|t| t.partitions().iter().map(|p| (t.name().to_string(), p.id()))).collect();
    // Message counts are a nice-to-have: show the list even if offsets time out.
    let marks = watermarks(&clients.metadata, &all_partitions).unwrap_or_default();

    let mut topics: Vec<TopicSummary> = md
        .topics()
        .iter()
        .filter(|t| t.error().is_none())
        .map(|t| {
            let partitions = t.partitions();
            TopicSummary {
                name: t.name().to_string(),
                partitions: partitions.len(),
                replication_factor: partitions.first().map_or(0, |p| p.replicas().len()),
                internal: is_internal(t.name()),
                message_count: partitions
                    .iter()
                    .filter_map(|p| marks.get(&(t.name().to_string(), p.id())))
                    .map(|w| w.message_count())
                    .sum(),
                under_replicated_partitions: partitions.iter().filter(|p| p.isr().len() < p.replicas().len()).count(),
            }
        })
        .collect();
    topics.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(topics)
}

pub fn partitions(clients: &KafkaClients, topic: &str) -> Result<Vec<Partition>> {
    let md = fetch_metadata(clients, Some(topic))?;
    let t = single_topic(md.topics(), topic)?;
    let keys: Vec<PartitionKey> = t.partitions().iter().map(|p| (topic.to_string(), p.id())).collect();
    let marks = watermarks(&clients.metadata, &keys)?;

    let mut partitions: Vec<Partition> = t
        .partitions()
        .iter()
        .map(|p| {
            let w = marks.get(&(topic.to_string(), p.id())).copied().unwrap_or_default();
            Partition {
                id: p.id(),
                leader: p.leader(),
                replicas: p.replicas().to_vec(),
                isr: p.isr().to_vec(),
                low: w.low,
                high: w.high,
            }
        })
        .collect();
    partitions.sort_by_key(|p| p.id);
    Ok(partitions)
}

pub async fn configs(clients: &KafkaClients, topic: &str) -> Result<Vec<TopicConfigEntry>> {
    let resource = clients
        .admin
        .describe_configs(&[ResourceSpecifier::Topic(topic)], &admin_options())
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| Error::msg("Broker returned no configuration"))?
        .map_err(|code| Error::msg(format!("Describe configs failed: {code}")))?;

    let mut entries: Vec<TopicConfigEntry> = resource
        .entries
        .into_iter()
        .map(|e| TopicConfigEntry {
            name: e.name,
            value: e.value,
            source: format!("{:?}", e.source),
            is_default: e.is_default,
            is_read_only: e.is_read_only,
            is_sensitive: e.is_sensitive,
        })
        .collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

pub async fn create(clients: &KafkaClients, request: &NewTopicRequest) -> Result<()> {
    let mut topic =
        NewTopic::new(&request.name, request.partitions, TopicReplication::Fixed(request.replication_factor));
    for (key, value) in &request.configs {
        topic = topic.set(key, value);
    }
    for result in clients.admin.create_topics([&topic], &admin_options()).await? {
        result.map_err(|(name, code)| Error::msg(format!("Create {name} failed: {code}")))?;
    }
    Ok(())
}

/// Deletes all `topics` in one request. One topic failing doesn't stop the
/// others, so the result reports each topic separately. Internal topics are
/// refused here, whatever the UI allowed.
pub async fn delete(clients: &KafkaClients, topics: &[String]) -> Result<Vec<DeleteTopicResult>> {
    let (internal, deletable): (Vec<&String>, Vec<&String>) = topics.iter().partition(|t| is_internal(t));
    let mut results: Vec<DeleteTopicResult> = internal
        .into_iter()
        .map(|topic| DeleteTopicResult {
            topic: topic.clone(),
            error: Some("internal topic, used by Kafka or a tool around it; not deleted".into()),
        })
        .collect();
    if deletable.is_empty() {
        return Ok(results);
    }
    let names: Vec<&str> = deletable.iter().map(|t| t.as_str()).collect();
    for result in clients.admin.delete_topics(&names, &admin_options()).await? {
        results.push(match result {
            Ok(topic) => DeleteTopicResult { topic, error: None },
            Err((topic, code)) => DeleteTopicResult { topic, error: Some(code.to_string()) },
        });
    }
    Ok(results)
}
