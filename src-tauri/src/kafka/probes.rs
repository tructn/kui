use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rdkafka::consumer::BaseConsumer;

use super::{ClusterConfig, new_consumer};
use crate::error::Result;

/// A probe unused for this long is closed. Long enough to cover refreshes
/// and moving between a topic's tabs, short enough not to hold connections
/// for groups nobody is looking at.
const IDLE: Duration = Duration::from_secs(180);

/// Most probes kept at once. Each is a librdkafka client with its own
/// threads (about 3 + one per broker), so the pool can't grow with the
/// group count unchecked. Beyond this the least recently used are closed.
const MAX_PROBES: usize = 200;

/// Offset probes kept alive between requests, one per consumer group.
///
/// Committed offsets can only be read through a consumer carrying the
/// group's id. A new one spends ~60 ms locally (far more over TLS + SASL to
/// a remote cluster) connecting and finding the group's coordinator before
/// its first answer; a warm one answers in under a millisecond. Reusing them
/// is what keeps the topic Consumers tab and the lag list fast on refresh.
pub struct Probes {
    cluster: ClusterConfig,
    pool: Mutex<HashMap<String, Probe<Arc<BaseConsumer>>>>,
}

struct Probe<C> {
    consumer: C,
    last_used: Instant,
}

impl Probes {
    pub fn new(cluster: ClusterConfig) -> Self {
        Self { cluster, pool: Mutex::default() }
    }

    /// The probe for `group`, creating it on first use. It carries the group
    /// id but never subscribes, so it never joins the group or triggers a
    /// rebalance.
    pub fn get(&self, group: &str) -> Result<Arc<BaseConsumer>> {
        if let Some(probe) = self.pool.lock().unwrap().get_mut(group) {
            probe.last_used = Instant::now();
            return Ok(probe.consumer.clone());
        }
        // Created outside the lock so parallel lookups for other groups
        // don't queue behind it.
        let created = Arc::new(new_consumer(&self.cluster, group)?);
        let (consumer, closed) = {
            let mut pool = self.pool.lock().unwrap();
            let now = Instant::now();
            // Another thread may have created the same probe meanwhile; keep theirs.
            let consumer = pool
                .entry(group.to_string())
                .or_insert_with(|| Probe { consumer: created.clone(), last_used: now })
                .consumer
                .clone();
            (consumer, evict(&mut pool, now))
        };
        // Closing a client waits for its threads, so do it after unlocking.
        drop(closed);
        Ok(consumer)
    }
}

/// Removes idle probes, then the least recently used beyond `MAX_PROBES`.
/// Returns them for the caller to drop; a probe still in use elsewhere stays
/// open until that use ends.
fn evict<C>(pool: &mut HashMap<String, Probe<C>>, now: Instant) -> Vec<Probe<C>> {
    let mut stale: Vec<String> =
        pool.iter().filter(|(_, p)| now.duration_since(p.last_used) > IDLE).map(|(g, _)| g.clone()).collect();
    let excess = (pool.len() - stale.len()).saturating_sub(MAX_PROBES);
    if excess > 0 {
        let mut live: Vec<(&String, Instant)> =
            pool.iter().filter(|(g, _)| !stale.contains(g)).map(|(g, p)| (g, p.last_used)).collect();
        live.sort_by_key(|&(_, used)| used);
        stale.extend(live.into_iter().take(excess).map(|(g, _)| g.clone()));
    }
    stale.iter().filter_map(|g| pool.remove(g)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool(ages_ms: &[(&str, u64)], now: Instant) -> HashMap<String, Probe<()>> {
        ages_ms
            .iter()
            .map(|&(g, age)| (g.to_string(), Probe { consumer: (), last_used: now - Duration::from_millis(age) }))
            .collect()
    }

    #[test]
    fn idle_probes_are_closed() {
        let now = Instant::now();
        let mut pool = pool(&[("fresh", 10), ("idle", IDLE.as_millis() as u64 + 1)], now);
        assert_eq!(evict(&mut pool, now).len(), 1);
        assert!(pool.contains_key("fresh") && !pool.contains_key("idle"));
    }

    #[test]
    fn least_recently_used_go_beyond_the_cap() {
        let now = Instant::now();
        let names: Vec<String> = (0..MAX_PROBES + 2).map(|i| format!("g{i}")).collect();
        // g0 is the most recently used, the last two the least.
        let ages: Vec<(&str, u64)> = names.iter().enumerate().map(|(i, g)| (g.as_str(), i as u64)).collect();
        let mut pool = pool(&ages, now);
        assert_eq!(evict(&mut pool, now).len(), 2);
        assert_eq!(pool.len(), MAX_PROBES);
        assert!(pool.contains_key("g0") && !pool.contains_key(&names[MAX_PROBES + 1]));
    }
}
