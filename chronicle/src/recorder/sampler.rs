//! Adaptive sampling for Cradle Chronicle capture intervals.

use crate::recorder::fingerprint::FrameFingerprint;

/// Tracks visual activity and recommends capture intervals.
#[derive(Debug)]
pub struct AdaptiveSampler {
    min_interval_ms: u64,
    max_interval_ms: u64,
    current_interval_ms: u64,
    previous_fingerprint: Option<FrameFingerprint>,
    consecutive_duplicates: u32,
    consecutive_changes: u32,
}

impl AdaptiveSampler {
    pub fn new(default_interval_ms: u64, min_interval_ms: u64, max_interval_ms: u64) -> Self {
        let clamped = default_interval_ms.clamp(min_interval_ms, max_interval_ms);
        Self {
            min_interval_ms,
            max_interval_ms,
            current_interval_ms: clamped,
            previous_fingerprint: None,
            consecutive_duplicates: 0,
            consecutive_changes: 0,
        }
    }

    /// Record a new frame observation and update the recommended interval.
    /// Returns `true` if the frame is different from the previous one.
    pub fn observe(&mut self, fingerprint: FrameFingerprint) -> bool {
        let is_change = match self.previous_fingerprint {
            Some(prev) => !fingerprint.is_duplicate_of(prev),
            None => true,
        };
        self.previous_fingerprint = Some(fingerprint);

        if is_change {
            self.consecutive_duplicates = 0;
            self.consecutive_changes += 1;
            // High activity: decrease interval toward min
            if self.consecutive_changes >= 2 {
                self.current_interval_ms =
                    (self.current_interval_ms * 3 / 4).max(self.min_interval_ms);
                println!(
                    "chronicle observed recent user input; pulling next display sample forward (interval={}ms)",
                    self.current_interval_ms
                );
            }
        } else {
            self.consecutive_changes = 0;
            self.consecutive_duplicates += 1;
            // Low activity: increase interval toward max
            if self.consecutive_duplicates >= 2 {
                self.current_interval_ms =
                    (self.current_interval_ms * 3 / 2).min(self.max_interval_ms);
                println!(
                    "chronicle capture was slow; backing off display sampling (interval={}ms)",
                    self.current_interval_ms
                );
            }
        }

        is_change
    }

    /// The recommended interval before the next capture.
    pub fn current_interval_ms(&self) -> u64 {
        self.current_interval_ms
    }

    /// Reset to default interval (e.g. after resuming from idle).
    pub fn reset(&mut self, default_interval_ms: u64) {
        self.current_interval_ms =
            default_interval_ms.clamp(self.min_interval_ms, self.max_interval_ms);
        self.consecutive_duplicates = 0;
        self.consecutive_changes = 0;
    }
}

#[cfg(test)]
mod tests {
    use crate::recorder::fingerprint::FrameFingerprint;

    use super::AdaptiveSampler;

    #[test]
    fn starts_at_default_interval() {
        let sampler = AdaptiveSampler::new(5000, 2000, 30000);
        assert_eq!(sampler.current_interval_ms(), 5000);
    }

    #[test]
    fn decreases_interval_on_activity() {
        let mut sampler = AdaptiveSampler::new(5000, 2000, 30000);
        // Simulate consecutive different frames
        let f1 = FrameFingerprint::from_parts(b"frame1", "text1");
        let f2 = FrameFingerprint::from_parts(b"frame2", "text2");
        let f3 = FrameFingerprint::from_parts(b"frame3", "text3");

        sampler.observe(f1);
        sampler.observe(f2);
        // After 2 consecutive changes, interval should decrease
        sampler.observe(f3);
        assert!(sampler.current_interval_ms() < 5000);
    }

    #[test]
    fn increases_interval_on_inactivity() {
        let mut sampler = AdaptiveSampler::new(5000, 2000, 30000);
        let same = FrameFingerprint::from_parts(b"frame", "text");

        sampler.observe(same);
        sampler.observe(same);
        // After 2 consecutive duplicates, interval should increase
        sampler.observe(same);
        assert!(sampler.current_interval_ms() > 5000);
    }

    #[test]
    fn respects_min_interval() {
        let mut sampler = AdaptiveSampler::new(2500, 2000, 30000);
        let f1 = FrameFingerprint::from_parts(b"a", "1");
        let f2 = FrameFingerprint::from_parts(b"b", "2");
        let f3 = FrameFingerprint::from_parts(b"c", "3");
        let f4 = FrameFingerprint::from_parts(b"d", "4");
        let f5 = FrameFingerprint::from_parts(b"e", "5");
        let f6 = FrameFingerprint::from_parts(b"f", "6");

        for fp in [f1, f2, f3, f4, f5, f6] {
            sampler.observe(fp);
        }
        assert!(sampler.current_interval_ms() >= 2000);
    }

    #[test]
    fn respects_max_interval() {
        let mut sampler = AdaptiveSampler::new(25000, 2000, 30000);
        let same = FrameFingerprint::from_parts(b"frame", "text");

        for _ in 0..20 {
            sampler.observe(same);
        }
        assert!(sampler.current_interval_ms() <= 30000);
    }

    #[test]
    fn reset_restores_default() {
        let mut sampler = AdaptiveSampler::new(5000, 2000, 30000);
        let same = FrameFingerprint::from_parts(b"frame", "text");
        for _ in 0..10 {
            sampler.observe(same);
        }
        sampler.reset(5000);
        assert_eq!(sampler.current_interval_ms(), 5000);
    }
}
