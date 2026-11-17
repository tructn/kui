use std::collections::VecDeque;
use std::time::{Duration, Instant};

const WINDOW: Duration = Duration::from_secs(60);

/// Sliding-window limit: at most `max` actions in any 60 seconds.
pub struct Throttle {
    max: usize,
    fired: VecDeque<Instant>,
}

impl Throttle {
    pub fn new(max_per_minute: u32) -> Self {
        Self { max: max_per_minute as usize, fired: VecDeque::new() }
    }

    /// Records a firing and returns true when there is room for it.
    pub fn allow(&mut self, now: Instant) -> bool {
        while self.fired.front().is_some_and(|t| now.duration_since(*t) >= WINDOW) {
            self.fired.pop_front();
        }
        if self.fired.len() >= self.max {
            return false;
        }
        self.fired.push_back(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_beyond_the_limit_and_recovers_after_the_window() {
        let start = Instant::now();
        let mut throttle = Throttle::new(2);
        assert!(throttle.allow(start));
        assert!(throttle.allow(start + Duration::from_secs(1)));
        assert!(!throttle.allow(start + Duration::from_secs(2)));
        assert!(!throttle.allow(start + Duration::from_secs(59)));
        assert!(throttle.allow(start + Duration::from_secs(60)));
    }

    #[test]
    fn a_dropped_message_does_not_extend_the_window() {
        let start = Instant::now();
        let mut throttle = Throttle::new(1);
        assert!(throttle.allow(start));
        assert!(!throttle.allow(start + Duration::from_secs(30)));
        assert!(throttle.allow(start + Duration::from_secs(60)));
    }
}
