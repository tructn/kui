use std::collections::{BTreeSet, HashMap};

use rdkafka::admin::AdminOptions;
use rdkafka::consumer::Consumer;
use rdkafka::groups::GroupInfo;

use super::model::{GroupDetail, GroupLag, GroupMember, GroupSummary, TopicConsumer};
use super::{assignment, progress};
use crate::error::{Error, Result};
use crate::kafka::metadata::{is_broker_internal, partition_ids};
use crate::kafka::offsets::{PartitionKey, committed, committed_by_group, watermarks};
use crate::kafka::{KafkaClients, TIMEOUT};

pub fn list(clients: &KafkaClients) -> Result<Vec<GroupSummary>> {
    let list = clients.metadata.fetch_group_list(None, TIMEOUT)?;
    let mut groups: Vec<GroupSummary> = list
        .groups()
        .iter()
        .map(|g| GroupSummary {
            name: g.name().to_string(),
            state: g.state().to_string(),
            protocol_type: g.protocol_type().to_string(),
            protocol: g.protocol().to_string(),
            members: g.members().len(),
        })
        .collect();
    groups.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(groups)
}

pub fn detail(clients: &KafkaClients, group: &str) -> Result<GroupDetail> {
    let list = clients.metadata.fetch_group_list(Some(group), TIMEOUT)?;
    let info = list.groups().first().ok_or_else(|| Error::msg(format!("Group not found: {group}")))?;
    let members = members(info);

    // Ask for the group's committed offset on every partition, then report
    // every partition of the topics it touched, so untouched ones show up too.
    let all = all_partitions(clients)?;
    let committed = committed(&clients.cluster, group, &all)?;
    let owners = owners(&members);
    let keys = partitions_of_touched_topics(&all, &committed, &owners);
    let marks = watermarks(&clients.metadata, &keys)?;

    let offsets = progress::partition_rows(&keys, &marks, &committed, &owners);
    let topics = progress::topic_progress(&offsets);
    Ok(GroupDetail {
        name: group.to_string(),
        state: info.state().to_string(),
        total_lag: topics.iter().map(|t| t.lag).sum(),
        members,
        topics,
        offsets,
    })
}

/// Total lag of every group. Slower than `list`: one offset request per group.
pub fn lags(clients: &KafkaClients) -> Result<Vec<GroupLag>> {
    let list = clients.metadata.fetch_group_list(None, TIMEOUT)?;
    let all = all_partitions(clients)?;
    let names: Vec<String> = list.groups().iter().map(|g| g.name().to_string()).collect();
    let committed = committed_by_group(&clients.cluster, &names, &all);

    // One watermark request for every partition any group has committed to.
    let committed_keys: BTreeSet<&PartitionKey> =
        committed.iter().filter_map(|(_, r)| r.as_ref().ok()).flat_map(|c| c.keys()).collect();
    let committed_keys: Vec<PartitionKey> = committed_keys.into_iter().cloned().collect();
    let marks = watermarks(&clients.metadata, &committed_keys)?;

    let infos: HashMap<&str, &GroupInfo> = list.groups().iter().map(|g| (g.name(), g)).collect();
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
    let marks = watermarks(&clients.metadata, &keys)?;
    let list = clients.metadata.fetch_group_list(None, TIMEOUT)?;
    let names: Vec<String> = list.groups().iter().map(|g| g.name().to_string()).collect();
    let mut committed: HashMap<String, HashMap<PartitionKey, i64>> =
        committed_by_group(&clients.cluster, &names, &keys)
            .into_iter()
            .filter_map(|(name, result)| Some((name, result.ok()?)))
            .collect();

    let mut consumers: Vec<TopicConsumer> = list
        .groups()
        .iter()
        .filter_map(|info| {
            let committed = committed.remove(info.name()).unwrap_or_default();
            let owners: HashMap<PartitionKey, String> =
                owners(&members(info)).into_iter().filter(|((t, _), _)| t == topic).collect();
            if committed.is_empty() && owners.is_empty() {
                return None; // this group does not read the topic
            }
            let offsets = progress::partition_rows(&keys, &marks, &committed, &owners);
            let progress = progress::topic_progress(&offsets).into_iter().next().unwrap_or_default();
            Some(TopicConsumer {
                group: info.name().to_string(),
                state: info.state().to_string(),
                members: info.members().len(),
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

fn members(info: &GroupInfo) -> Vec<GroupMember> {
    info.members()
        .iter()
        .map(|m| GroupMember {
            id: m.id().to_string(),
            client_id: m.client_id().to_string(),
            host: m.client_host().to_string(),
            assignment: m.assignment().map(assignment::decode).unwrap_or_default(),
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
    let md = clients.metadata.fetch_metadata(None, TIMEOUT)?;
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
