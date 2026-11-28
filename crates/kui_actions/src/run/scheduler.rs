use std::collections::{HashMap, HashSet, VecDeque};

use super::source::NextOffsets;
use crate::record::Record;

/// Messages fetched ahead of the invocations. Past this, fetching pauses.
pub const BUFFER_LIMIT: usize = 256;

/// Decides which fetched records may start: at most one per partition and
/// `concurrency` overall, in offset order within a partition.
pub struct Scheduler {
    concurrency: usize,
    /// Fetched records waiting for their partition to be free.
    queues: HashMap<i32, VecDeque<Record>>,
    /// Partitions with an invocation in flight.
    busy: HashSet<i32>,
    buffered: usize,
    finished: NextOffsets,
}

impl Scheduler {
    pub fn new(concurrency: usize) -> Self {
        Scheduler {
            concurrency: concurrency.max(1),
            queues: HashMap::new(),
            busy: HashSet::new(),
            buffered: 0,
            finished: HashMap::new(),
        }
    }

    pub fn push(&mut self, record: Record) {
        self.queues.entry(record.partition).or_default().push_back(record);
        self.buffered += 1;
    }

    /// Takes the records that may start now and marks their partitions busy.
    pub fn take_ready(&mut self) -> Vec<Record> {
        let mut ready = Vec::new();
        for (partition, queue) in &mut self.queues {
            if self.busy.len() >= self.concurrency {
                break;
            }
            if self.busy.contains(partition) {
                continue;
            }
            if let Some(record) = queue.pop_front() {
                self.buffered -= 1;
                self.busy.insert(*partition);
                ready.push(record);
            }
        }
        ready
    }

    pub fn finish(&mut self, record: &Record) {
        self.busy.remove(&record.partition);
        self.finished.insert((record.topic.clone(), record.partition), record.offset + 1);
    }

    /// Frees the partition without queuing a commit, so the group resumes at `record`.
    pub fn abandon(&mut self, record: &Record) {
        self.busy.remove(&record.partition);
    }

    pub fn in_flight(&self) -> usize {
        self.busy.len()
    }

    pub fn is_full(&self) -> bool {
        self.buffered >= BUFFER_LIMIT
    }

    /// The offsets finished since the last call.
    pub fn take_commits(&mut self) -> NextOffsets {
        std::mem::take(&mut self.finished)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn partitions(records: &[Record]) -> Vec<i32> {
        let mut ids: Vec<i32> = records.iter().map(|r| r.partition).collect();
        ids.sort_unstable();
        ids
    }

    #[test]
    fn starts_one_record_per_partition() {
        let mut s = Scheduler::new(8);
        for offset in 0..3 {
            s.push(Record::sample(0, offset));
            s.push(Record::sample(1, offset));
        }
        let ready = s.take_ready();
        assert_eq!(partitions(&ready), [0, 1]);
        assert!(ready.iter().all(|r| r.offset == 0));
        assert!(s.take_ready().is_empty(), "both partitions are busy");
        assert_eq!(s.in_flight(), 2);
    }

    #[test]
    fn respects_concurrency_across_partitions() {
        let mut s = Scheduler::new(2);
        for partition in 0..5 {
            s.push(Record::sample(partition, 0));
        }
        assert_eq!(s.take_ready().len(), 2);
        assert!(s.take_ready().is_empty());
    }

    #[test]
    fn finishing_frees_the_partition_and_queues_its_commit() {
        let mut s = Scheduler::new(1);
        s.push(Record::sample(0, 7));
        s.push(Record::sample(0, 8));
        let first = s.take_ready().remove(0);
        s.finish(&first);
        assert_eq!(s.take_commits(), HashMap::from([(("t".to_string(), 0), 8)]));
        assert!(s.take_commits().is_empty(), "commits are handed out once");
        assert_eq!(s.take_ready()[0].offset, 8);
    }

    #[test]
    fn abandoning_frees_the_partition_without_a_commit() {
        let mut s = Scheduler::new(1);
        s.push(Record::sample(0, 7));
        let first = s.take_ready().remove(0);
        s.abandon(&first);
        assert_eq!(s.in_flight(), 0);
        assert!(s.take_commits().is_empty());
    }

    #[test]
    fn is_full_at_the_buffer_limit() {
        let mut s = Scheduler::new(1);
        for offset in 0..BUFFER_LIMIT as i64 {
            assert!(!s.is_full());
            s.push(Record::sample(0, offset));
        }
        assert!(s.is_full());
        s.take_ready();
        assert!(!s.is_full());
    }
}
