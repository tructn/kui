//! Where a reset moves each partition. Pure, so it is testable without Kafka.

use std::collections::HashMap;

use super::model::{OffsetChange, ResetTo};
use crate::kafka::offsets::Watermarks;

/// The new committed offset of every partition in `marks`, sorted by partition.
///
/// `at_time` holds, per partition, the first offset at or after the
/// `ResetTo::Timestamp` time. A partition missing from it has no message
/// that recent, so it moves to the end, as `kafka-consumer-groups` does.
pub fn plan(
    to: ResetTo,
    marks: &HashMap<i32, Watermarks>,
    committed: &HashMap<i32, i64>,
    at_time: &HashMap<i32, i64>,
) -> Vec<OffsetChange> {
    let mut changes: Vec<OffsetChange> = marks
        .iter()
        .map(|(&partition, w)| {
            let target = match to {
                ResetTo::Earliest => w.low,
                ResetTo::Latest => w.high,
                ResetTo::Timestamp { .. } => at_time.get(&partition).copied().unwrap_or(w.high),
                ResetTo::Offset { value } => value,
            };
            OffsetChange {
                partition,
                low: w.low,
                high: w.high,
                current: committed.get(&partition).copied(),
                // An offset outside the log would leave the group out of range.
                target: target.clamp(w.low, w.high),
            }
        })
        .collect();
    changes.sort_by_key(|c| c.partition);
    changes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marks() -> HashMap<i32, Watermarks> {
        [(0, Watermarks { low: 10, high: 50 }), (1, Watermarks { low: 0, high: 5 })].into()
    }

    fn targets(to: ResetTo, at_time: &HashMap<i32, i64>) -> Vec<i64> {
        plan(to, &marks(), &[(0, 40)].into(), at_time).iter().map(|c| c.target).collect()
    }

    #[test]
    fn earliest_and_latest_use_the_watermarks() {
        assert_eq!(targets(ResetTo::Earliest, &HashMap::new()), [10, 0]);
        assert_eq!(targets(ResetTo::Latest, &HashMap::new()), [50, 5]);
    }

    #[test]
    fn offsets_are_kept_inside_the_log() {
        assert_eq!(targets(ResetTo::Offset { value: 20 }, &HashMap::new()), [20, 5]);
        assert_eq!(targets(ResetTo::Offset { value: -3 }, &HashMap::new()), [10, 0]);
    }

    #[test]
    fn a_time_after_the_last_message_moves_to_the_end() {
        assert_eq!(targets(ResetTo::Timestamp { value: 0 }, &[(0, 30)].into()), [30, 5]);
    }

    #[test]
    fn reports_the_current_offset_and_sorts_by_partition() {
        let changes = plan(ResetTo::Earliest, &marks(), &[(0, 40)].into(), &HashMap::new());
        assert_eq!(changes.iter().map(|c| (c.partition, c.current)).collect::<Vec<_>>(), [(0, Some(40)), (1, None)]);
    }
}
