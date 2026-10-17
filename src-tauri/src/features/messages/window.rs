//! Paging through a topic: which offsets each page reads, and how the
//! partitions' reads merge into one page ordered by time.
//!
//! A page is read with a *cursor*: per partition, the position to continue from.
//! Reading forward that is the next offset to read; reading backward (newest
//! first) it is the exclusive upper bound, i.e. everything below it is unread.

use std::collections::{BTreeMap, VecDeque};

use super::model::{Message, StartFrom};
use crate::kafka::offsets::Watermarks;

/// Per-partition positions to continue from, keyed by partition id.
pub type Cursor = BTreeMap<i32, i64>;

/// Half-open offset range `[start, end)` to read from one partition.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReadWindow {
    pub start: i64,
    pub end: i64,
}

/// Where the first page starts in a partition.
///
/// `seek` is the requested offset for `StartFrom::Offset`, or the offset already
/// resolved from a timestamp for `StartFrom::Timestamp` (`None`: nothing at/after it).
pub fn start_position(from: StartFrom, marks: Watermarks, seek: Option<i64>) -> i64 {
    let Watermarks { low, high } = marks;
    match from {
        StartFrom::Latest => high,
        StartFrom::Earliest => low,
        StartFrom::Offset | StartFrom::Timestamp => seek.unwrap_or(high).clamp(low, high),
    }
}

/// The offsets one page may need from a partition, or `None` if it has nothing left.
/// The position is clamped, since retention can move `low` between pages.
pub fn page_window(position: i64, marks: Watermarks, size: i64, backward: bool) -> Option<ReadWindow> {
    let Watermarks { low, high } = marks;
    let position = position.clamp(low, high);
    let (start, end) = if backward {
        ((position - size).max(low), position)
    } else {
        (position, position.saturating_add(size).min(high))
    };
    (start < end).then_some(ReadWindow { start, end })
}

/// Offsets left to read from `position` on. Compacted topics have gaps, so this
/// is an upper bound on the number of messages.
pub fn remaining(position: i64, marks: Watermarks, backward: bool) -> i64 {
    let position = position.clamp(marks.low, marks.high);
    if backward { position - marks.low } else { marks.high - position }
}

/// What one partition returned for a page: its window and messages in offset order.
pub struct PartitionRead {
    pub partition: i32,
    pub window: ReadWindow,
    pub messages: Vec<Message>,
}

/// Merges the partitions' reads into one page of at most `size` messages,
/// newest first when `backward`, otherwise oldest first.
///
/// It is a k-way merge on each partition's next message, so every partition
/// contributes a run of consecutive offsets and the returned cursor can resume
/// exactly where the page stopped, even when timestamps are out of order.
pub fn merge_page(reads: Vec<PartitionRead>, size: usize, backward: bool) -> (Vec<Message>, Cursor) {
    let mut queues: Vec<(i32, ReadWindow, VecDeque<Message>)> = reads
        .into_iter()
        .map(|read| {
            let mut queue: VecDeque<Message> = read.messages.into();
            if backward {
                queue.make_contiguous().reverse();
            }
            (read.partition, read.window, queue)
        })
        .collect();

    let mut page = Vec::with_capacity(size);
    while page.len() < size {
        let heads = queues
            .iter()
            .enumerate()
            .filter_map(|(i, (_, _, queue))| queue.front().map(|m| ((m.timestamp, m.partition), i)));
        let next = if backward { heads.max() } else { heads.min() };
        let Some((_, i)) = next else { break };
        page.extend(queues[i].2.pop_front());
    }

    let cursor = queues
        .iter()
        .map(|(partition, window, queue)| {
            let position = match (queue.front(), backward) {
                (Some(unread), true) => unread.offset + 1,
                (Some(unread), false) => unread.offset,
                (None, true) => window.start,
                (None, false) => window.end,
            };
            (*partition, position)
        })
        .collect();
    (page, cursor)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARKS: Watermarks = Watermarks { low: 10, high: 110 };

    fn msg(partition: i32, offset: i64, timestamp: i64) -> Message {
        Message { partition, offset, timestamp: Some(timestamp), key: None, value: None, headers: Vec::new() }
    }

    fn read(partition: i32, window: (i64, i64), stamps: &[(i64, i64)]) -> PartitionRead {
        let messages = stamps.iter().map(|&(offset, ts)| msg(partition, offset, ts)).collect();
        PartitionRead { partition, window: ReadWindow { start: window.0, end: window.1 }, messages }
    }

    fn ids(page: &[Message]) -> Vec<(i32, i64)> {
        page.iter().map(|m| (m.partition, m.offset)).collect()
    }

    #[test]
    fn first_page_starts_at_the_requested_end() {
        assert_eq!(start_position(StartFrom::Latest, MARKS, None), 110);
        assert_eq!(start_position(StartFrom::Earliest, MARKS, None), 10);
        assert_eq!(start_position(StartFrom::Offset, MARKS, Some(0)), 10);
        assert_eq!(start_position(StartFrom::Offset, MARKS, Some(500)), 110);
        // A timestamp after the last message resolves to nothing: start at the end.
        assert_eq!(start_position(StartFrom::Timestamp, MARKS, None), 110);
    }

    #[test]
    fn windows_step_through_the_partition_in_either_direction() {
        assert_eq!(page_window(110, MARKS, 20, true), Some(ReadWindow { start: 90, end: 110 }));
        assert_eq!(page_window(15, MARKS, 20, true), Some(ReadWindow { start: 10, end: 15 }));
        assert_eq!(page_window(10, MARKS, 20, false), Some(ReadWindow { start: 10, end: 30 }));
        assert_eq!(page_window(105, MARKS, 20, false), Some(ReadWindow { start: 105, end: 110 }));
    }

    #[test]
    fn exhausted_or_empty_partitions_have_no_window() {
        assert_eq!(page_window(10, MARKS, 20, true), None);
        assert_eq!(page_window(110, MARKS, 20, false), None);
        assert_eq!(page_window(5, Watermarks { low: 5, high: 5 }, 20, false), None);
        // Retention moved `low` past the cursor: carry on from `low`.
        assert_eq!(page_window(0, MARKS, 5, false), Some(ReadWindow { start: 10, end: 15 }));
    }

    #[test]
    fn remaining_counts_offsets_left_in_the_reading_direction() {
        assert_eq!(remaining(110, MARKS, true), 100);
        assert_eq!(remaining(100, MARKS, false), 10);
        assert_eq!(remaining(500, MARKS, false), 0);
    }

    #[test]
    fn newest_first_page_interleaves_partitions_by_time() {
        let reads =
            vec![read(0, (7, 10), &[(7, 100), (8, 300), (9, 500)]), read(1, (2, 5), &[(2, 200), (3, 400), (4, 600)])];
        let (page, cursor) = merge_page(reads, 4, true);
        assert_eq!(ids(&page), vec![(1, 4), (0, 9), (1, 3), (0, 8)]);
        // Unread: partition 0 offset 7, partition 1 offset 2 → continue below them.
        assert_eq!(cursor, Cursor::from([(0, 8), (1, 3)]));
    }

    #[test]
    fn forward_page_resumes_after_the_last_message_taken() {
        let reads =
            vec![read(0, (0, 3), &[(0, 100), (1, 300), (2, 500)]), read(1, (0, 3), &[(0, 200), (1, 400), (2, 600)])];
        let (page, cursor) = merge_page(reads, 3, false);
        assert_eq!(ids(&page), vec![(0, 0), (1, 0), (0, 1)]);
        assert_eq!(cursor, Cursor::from([(0, 2), (1, 1)]));
    }

    #[test]
    fn a_fully_used_partition_continues_after_its_window_even_across_gaps() {
        // Compaction left only offsets 3 and 7 in the window [0, 10).
        let (page, cursor) = merge_page(vec![read(0, (0, 10), &[(3, 1), (7, 2)])], 5, false);
        assert_eq!(ids(&page), vec![(0, 3), (0, 7)]);
        assert_eq!(cursor, Cursor::from([(0, 10)]));
    }

    #[test]
    fn out_of_order_timestamps_still_take_consecutive_offsets() {
        // Offset 1 has an older timestamp than offset 0; the merge must not skip offset 0.
        let (page, cursor) = merge_page(vec![read(0, (0, 3), &[(0, 500), (1, 100), (2, 600)])], 1, false);
        assert_eq!(ids(&page), vec![(0, 0)]);
        assert_eq!(cursor, Cursor::from([(0, 1)]));
    }
}
