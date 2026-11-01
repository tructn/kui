use std::collections::{BTreeSet, HashMap};

use rdkafka::admin::AdminOptions;
use rdkafka::consumer::{CommitMode, Consumer};
use rdkafka::{Offset, TopicPartitionList};

use super::model::{
    GroupDetail, GroupLag, GroupMember, GroupSummary, OffsetChange, ResetRequest, ResetTo, TopicConsumer,
};
use super::{progress, reset};
use crate::error::{Error, Result};
use crate::kafka::connection::{explain, rejection};
use crate::kafka::groups::{self, GroupDescription};
use crate::kafka::metadata::{fetch_metadata, is_broker_internal, partition_ids};
use crate::kafka::offsets::{PartitionKey, committed, committed_by_group, offsets_at, watermarks};
use crate::kafka::{KafkaClients, TIMEOUT, new_consumer};

pub fn list(clients: &KafkaClients) -> Result<Vec<GroupSummary>> {
    Ok(all_groups(clients)?
        .into_iter()
        .map(|g| GroupSummary {
            name: g.name,
            state: g.state,
            group_type: g.group_type,
            protocol: g.assignor,
            members: g.members.len(),
        })
        .collect())
}

pub fn detail(clients: &KafkaClients, group: &str) -> Result<GroupDetail> {
    let info = groups::describe_one(&clients.admin, group).map_err(|e| connection_error(clients, e))?;
    let members = members(&info);

    // Ask for the group's committed offset on every partition, then report
    // every partition of the topics it touched, so untouched ones show up too.
    let all = all_partitions(clients)?;
    let committed = committed(&clients.admin, group, &all)?;
    let owners = owners(&members);
    let keys = partitions_of_touched_topics(&all, &committed, &owners);
    let marks = watermarks(&clients.metadata, &keys)?;

    let offsets = progress::partition_rows(&keys, &marks, &committed, &owners);
    let topics = progress::topic_progress(&offsets);
    Ok(GroupDetail {
        name: group.to_string(),
        state: info.state,
        total_lag: topics.iter().map(|t| t.lag).sum(),
        members,
        topics,
        offsets,
    })
}

/// Total lag of every group. Slower than `list`: one offset request per group.
pub fn lags(clients: &KafkaClients) -> Result<Vec<GroupLag>> {
    let list = all_groups(clients)?;
    let all = all_partitions(clients)?;
    let names: Vec<String> = list.iter().map(|g| g.name.clone()).collect();
    let committed = committed_by_group(&clients.admin, &names, &all);

    // One watermark request for every partition any group has committed to.
    let committed_keys: BTreeSet<&PartitionKey> =
        committed.iter().filter_map(|(_, r)| r.as_ref().ok()).flat_map(|c| c.keys()).collect();
    let committed_keys: Vec<PartitionKey> = committed_keys.into_iter().cloned().collect();
    let marks = watermarks(&clients.metadata, &committed_keys)?;

    let infos: HashMap<&str, &GroupDescription> = list.iter().map(|g| (g.name.as_str(), g)).collect();
    let mut lags: Vec<GroupLag> = committed
        .into_iter()
        .map(|(name, committed)| {
            let assigned = infos.get(name.as_str()).map(|i| owners(&members(i))).unwrap_or_default();
            let mut topics: BTreeSet<String> = assigned.keys().map(|(t, _)| t.clone()).collect();
            let lag = committed.ok().map(|committed| {
                topics.extend(committed.keys().map(|(t, _)| t.clone()));
                committed.iter().map(|(key, &c)| marks.get(key).map_or(0, |w| (w.high - c).max(0))).sum()
            });
            GroupLag { name, topics: topics.into_iter().collect(), lag }
        })
        .collect();
    lags.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(lags)
}

/// Every group that has committed to or is assigned a partition of `topic`,
/// with how far it has read each partition.
pub fn topic_consumers(clients: &KafkaClients, topic: &str) -> Result<Vec<TopicConsumer>> {
    let keys: Vec<PartitionKey> =
        partition_ids(&clients.metadata, topic)?.into_iter().map(|p| (topic.to_string(), p)).collect();
    // The topic's watermarks don't depend on the groups, so fetch them while
    // the groups are probed.
    let (marks, list, committed) = std::thread::scope(|s| {
        let marks = s.spawn(|| watermarks(&clients.metadata, &keys));
        let list = all_groups(clients)?;
        let names: Vec<String> = list.iter().map(|g| g.name.clone()).collect();
        let committed = committed_by_group(&clients.admin, &names, &keys);
        Ok::<_, Error>((marks.join().expect("watermark lookup panicked")?, list, committed))
    })?;
    let mut committed: HashMap<String, HashMap<PartitionKey, i64>> =
        committed.into_iter().filter_map(|(name, result)| Some((name, result.ok()?))).collect();

    let mut consumers: Vec<TopicConsumer> = list
        .iter()
        .filter_map(|info| {
            let committed = committed.remove(&info.name).unwrap_or_default();
            let owners: HashMap<PartitionKey, String> =
                owners(&members(info)).into_iter().filter(|((t, _), _)| t == topic).collect();
            if committed.is_empty() && owners.is_empty() {
                return None; // this group does not read the topic
            }
            let offsets = progress::partition_rows(&keys, &marks, &committed, &owners);
            let progress = progress::topic_progress(&offsets).into_iter().next().unwrap_or_default();
            Some(TopicConsumer {
                group: info.name.clone(),
                state: info.state.clone(),
                members: info.members.len(),
                progress,
                offsets,
            })
        })
        .collect();
    consumers.sort_by(|a, b| a.group.cmp(&b.group));
    Ok(consumers)
}

pub async fn delete(clients: &KafkaClients, group: &str) -> Result<()> {
    let options = AdminOptions::new().request_timeout(Some(TIMEOUT));
    for result in clients.admin.delete_groups(&[group], &options).await? {
        result.map_err(|(name, code)| Error::msg(format!("Delete {name} failed: {code}")))?;
    }
    Ok(())
}

/// What `reset_offsets` would change, without changing anything.
pub fn plan_reset(clients: &KafkaClients, request: &ResetRequest) -> Result<Vec<OffsetChange>> {
    let keys = reset_partitions(clients, request)?;
    let marks = watermarks(&clients.metadata, &keys)?;
    let current = committed(&clients.admin, &request.group, &keys)?;
    let at_time = match request.to {
        ResetTo::Timestamp { value } => offsets_at(&clients.metadata, &keys, Offset::Offset(value))?,
        _ => HashMap::new(),
    };
    Ok(reset::plan(request.to, &by_partition(marks), &by_partition(current), &by_partition(at_time)))
}

/// Moves the group's committed offsets on one topic, e.g. back to replay
/// messages after a bug fix. Returns what changed.
///
/// Kafka only accepts this while the group has no active members: a running
/// consumer would overwrite the new offsets with its own on its next commit.
pub fn reset_offsets(clients: &KafkaClients, request: &ResetRequest) -> Result<Vec<OffsetChange>> {
    ensure_inactive(clients, &request.group)?;
    let changes = plan_reset(clients, request)?;
    let mut offsets = TopicPartitionList::new();
    for c in &changes {
        offsets.add_partition_offset(&request.topic, c.partition, Offset::Offset(c.target))?;
    }
    // Carries the group's id but never subscribes, so it never joins the group: it only commits.
    let consumer = new_consumer(&clients.cluster, &request.group)?;
    consumer.commit(&offsets, CommitMode::Sync).map_err(|e| explain(&consumer, e))?;

    // A commit doesn't report failures per partition, so read the offsets back.
    let keys: Vec<PartitionKey> = changes.iter().map(|c| (request.topic.clone(), c.partition)).collect();
    let now = by_partition(committed(&clients.admin, &request.group, &keys)?);
    let failed: Vec<String> =
        changes.iter().filter(|c| now.get(&c.partition) != Some(&c.target)).map(|c| c.partition.to_string()).collect();
    if !failed.is_empty() {
        return Err(Error::msg(format!("Kafka did not accept the new offsets for partition(s) {}", failed.join(", "))));
    }
    Ok(changes)
}

fn ensure_inactive(clients: &KafkaClients, group: &str) -> Result<()> {
    let members = groups::describe_one(&clients.admin, group).map_err(|e| connection_error(clients, e))?.members.len();
    if members > 0 {
        return Err(Error::msg(format!(
            "{group} has {members} active member(s). Stop its consumers first: \
             offsets can only be reset while no consumer is connected."
        )));
    }
    Ok(())
}

/// The topic's partitions a reset applies to.
fn reset_partitions(clients: &KafkaClients, request: &ResetRequest) -> Result<Vec<PartitionKey>> {
    let keys: Vec<PartitionKey> = partition_ids(&clients.metadata, &request.topic)?
        .into_iter()
        .filter(|p| request.partitions.as_ref().is_none_or(|wanted| wanted.contains(p)))
        .map(|p| (request.topic.clone(), p))
        .collect();
    if keys.is_empty() {
        return Err(Error::msg("No matching partitions"));
    }
    Ok(keys)
}

/// Drops the topic from keys of one topic.
fn by_partition<T>(by_key: HashMap<PartitionKey, T>) -> HashMap<i32, T> {
    by_key.into_iter().map(|((_, partition), v)| (partition, v)).collect()
}

/// Every consumer group, classic or KIP-848, sorted by name.
fn all_groups(clients: &KafkaClients) -> Result<Vec<GroupDescription>> {
    let names = groups::list(&clients.admin).map_err(|e| connection_error(clients, e))?;
    let mut list = groups::describe(&clients.admin, &names).map_err(|e| connection_error(clients, e))?;
    list.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(list)
}

/// The cluster's reason for turning the connection down, if it did, rather
/// than the admin request's bare timeout.
fn connection_error(clients: &KafkaClients, e: Error) -> Error {
    rejection(&clients.metadata).unwrap_or(e)
}

fn members(info: &GroupDescription) -> Vec<GroupMember> {
    info.members
        .iter()
        .map(|m| GroupMember {
            id: m.id.clone(),
            client_id: m.client_id.clone(),
            host: m.host.clone(),
            assignment: m.assignment.clone(),
        })
        .collect()
}

/// partition -> client id of the member assigned to it.
fn owners(members: &[GroupMember]) -> HashMap<PartitionKey, String> {
    members
        .iter()
        .flat_map(|m| {
            m.assignment.iter().flat_map(move |(topic, partitions)| {
                partitions.iter().map(move |&p| ((topic.clone(), p), m.client_id.clone()))
            })
        })
        .collect()
}

/// Every partition of every topic except Kafka's own (ksqlDB's internal
/// repartition topics are consumed, so their lag matters).
fn all_partitions(clients: &KafkaClients) -> Result<Vec<PartitionKey>> {
    let md = fetch_metadata(clients, None)?;
    Ok(md
        .topics()
        .iter()
        .filter(|t| !is_broker_internal(t.name()))
        .flat_map(|t| t.partitions().iter().map(|p| (t.name().to_string(), p.id())))
        .collect())
}

/// The partitions in `all` whose topic the group has committed to or is assigned.
fn partitions_of_touched_topics(
    all: &[PartitionKey],
    committed: &HashMap<PartitionKey, i64>,
    owners: &HashMap<PartitionKey, String>,
) -> Vec<PartitionKey> {
    let touched: BTreeSet<&str> = committed.keys().chain(owners.keys()).map(|(t, _)| t.as_str()).collect();
    all.iter().filter(|(t, _)| touched.contains(t.as_str())).cloned().collect()
}
