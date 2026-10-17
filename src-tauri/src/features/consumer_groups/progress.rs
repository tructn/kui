//! Turns watermarks + committed offsets into per-partition status and
//! per-topic totals. Pure, so it is tested without a broker.

use std::collections::{BTreeMap, HashMap};

use super::model::{PartitionOffset, PartitionStatus, TopicProgress};
use crate::kafka::offsets::{PartitionKey, Watermarks};

pub fn status(marks: Watermarks, committed: Option<i64>) -> PartitionStatus {
    match committed {
        None => PartitionStatus::NotStarted,
        Some(c) if c < marks.low => PartitionStatus::OutOfRange,
        Some(c) if c >= marks.high => PartitionStatus::CaughtUp,
        Some(_) => PartitionStatus::Behind,
    }
}

/// One row per partition in `partitions`, sorted by topic and partition.
pub fn partition_rows(
    partitions: &[PartitionKey],
    marks: &HashMap<PartitionKey, Watermarks>,
    committed: &HashMap<PartitionKey, i64>,
    owners: &HashMap<PartitionKey, String>,
) -> Vec<PartitionOffset> {
    let mut rows: Vec<PartitionOffset> = partitions
        .iter()
        .map(|key| {
            let committed = committed.get(key).copied();
            // Without watermarks, assume the group is at the end rather than invent lag.
            let w = marks.get(key).copied().unwrap_or_else(|| {
                let at = committed.unwrap_or(0);
                Watermarks { low: at, high: at }
            });
            PartitionOffset {
                topic: key.0.clone(),
                partition: key.1,
                low: w.low,
                high: w.high,
                committed,
                lag: committed.map(|c| (w.high - c).max(0)),
                status: status(w, committed),
                owner: owners.get(key).cloned(),
            }
        })
        .collect();
    rows.sort_by(|a, b| (&a.topic, a.partition).cmp(&(&b.topic, b.partition)));
    rows
}

/// Totals per topic, sorted by topic name.
pub fn topic_progress(rows: &[PartitionOffset]) -> Vec<TopicProgress> {
    let mut topics: BTreeMap<&str, TopicProgress> = BTreeMap::new();
    for row in rows {
        let t = topics
            .entry(&row.topic)
            .or_insert_with(|| TopicProgress { topic: row.topic.clone(), ..Default::default() });
        t.partitions += 1;
        t.lag += row.lag.unwrap_or(0);
        match (row.status, row.committed) {
            (PartitionStatus::NotStarted, _) | (_, None) => {
                t.not_started += 1;
                t.untouched += row.high - row.low;
            }
            (status, Some(c)) => {
                t.consumed += c.clamp(row.low, row.high) - row.low;
                match status {
                    PartitionStatus::CaughtUp => t.caught_up += 1,
                    PartitionStatus::Behind => t.behind += 1,
                    _ => t.out_of_range += 1,
                }
            }
        }
    }
    topics.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(topic: &str, partition: i32) -> PartitionKey {
        (topic.to_string(), partition)
    }

    fn marks(low: i64, high: i64) -> Watermarks {
        Watermarks { low, high }
    }

    #[test]
    fn status_covers_every_case() {
        assert_eq!(status(marks(0, 10), None), PartitionStatus::NotStarted);
        assert_eq!(status(marks(0, 10), Some(4)), PartitionStatus::Behind);
        assert_eq!(status(marks(0, 10), Some(10)), PartitionStatus::CaughtUp);
        assert_eq!(status(marks(5, 10), Some(2)), PartitionStatus::OutOfRange);
        // An empty partition with nothing committed is still untouched.
        assert_eq!(status(marks(0, 0), None), PartitionStatus::NotStarted);
        assert_eq!(status(marks(0, 0), Some(0)), PartitionStatus::CaughtUp);
    }

    #[test]
    fn rows_include_untouched_partitions_and_owners() {
        let partitions = [key("b", 0), key("a", 1), key("a", 0)];
        let marks =
            HashMap::from([(key("a", 0), marks(0, 10)), (key("a", 1), marks(0, 8)), (key("b", 0), marks(2, 6))]);
        let committed = HashMap::from([(key("a", 0), 4)]);
        let owners = HashMap::from([(key("a", 1), "worker-1".to_string())]);

        let rows = partition_rows(&partitions, &marks, &committed, &owners);
        let summary: Vec<_> = rows
            .iter()
            .map(|r| (r.topic.as_str(), r.partition, r.committed, r.lag, r.status, r.owner.as_deref()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("a", 0, Some(4), Some(6), PartitionStatus::Behind, None),
                ("a", 1, None, None, PartitionStatus::NotStarted, Some("worker-1")),
                ("b", 0, None, None, PartitionStatus::NotStarted, None),
            ]
        );
    }

    #[test]
    fn missing_watermarks_do_not_invent_lag() {
        let rows = partition_rows(&[key("a", 0)], &HashMap::new(), &HashMap::from([(key("a", 0), 7)]), &HashMap::new());
        assert_eq!((rows[0].lag, rows[0].status), (Some(0), PartitionStatus::CaughtUp));
    }

    #[test]
    fn topic_totals_split_consumed_lag_and_untouched() {
        let partitions = [key("a", 0), key("a", 1), key("a", 2), key("a", 3)];
        let marks = HashMap::from([
            (key("a", 0), marks(0, 10)),  // behind: 4 consumed, 6 lag
            (key("a", 1), marks(0, 5)),   // caught up: 5 consumed
            (key("a", 2), marks(0, 7)),   // not started: 7 untouched
            (key("a", 3), marks(20, 30)), // out of range: 0 consumed, 15 lag
        ]);
        let committed = HashMap::from([(key("a", 0), 4), (key("a", 1), 5), (key("a", 3), 15)]);
        let rows = partition_rows(&partitions, &marks, &committed, &HashMap::new());

        assert_eq!(
            topic_progress(&rows),
            vec![TopicProgress {
                topic: "a".into(),
                partitions: 4,
                caught_up: 1,
                behind: 1,
                not_started: 1,
                out_of_range: 1,
                consumed: 9,
                lag: 21,
                untouched: 7,
            }]
        );
    }
}
