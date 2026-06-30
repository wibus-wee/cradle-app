//! PCM buffering and simple RMS activity gating for local audio diagnostics.

#[derive(Debug, Clone, PartialEq)]
pub struct AudioActivityReport {
    pub rms: f32,
    pub peak: f32,
    pub active: bool,
    pub sample_count: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RmsActivityGate {
    threshold: f32,
}

impl RmsActivityGate {
    pub fn new(threshold: f32) -> Self {
        Self {
            threshold: threshold.max(0.0),
        }
    }

    pub fn analyze(&self, samples: &[f32]) -> AudioActivityReport {
        if samples.is_empty() {
            return AudioActivityReport {
                rms: 0.0,
                peak: 0.0,
                active: false,
                sample_count: 0,
            };
        }

        let mut square_sum = 0.0_f64;
        let mut peak = 0.0_f32;
        for sample in samples {
            let clamped = sample.clamp(-1.0, 1.0);
            square_sum += f64::from(clamped * clamped);
            peak = peak.max(clamped.abs());
        }
        let rms = (square_sum / samples.len() as f64).sqrt() as f32;
        AudioActivityReport {
            rms,
            peak,
            active: rms >= self.threshold,
            sample_count: samples.len(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct BoundedPcmBuffer {
    samples: Vec<f32>,
    max_samples: usize,
    dropped_samples: usize,
}

impl BoundedPcmBuffer {
    pub fn new(max_samples: usize) -> Self {
        Self {
            samples: Vec::with_capacity(max_samples.min(8192)),
            max_samples,
            dropped_samples: 0,
        }
    }

    pub fn push(&mut self, input: &[f32]) {
        if self.max_samples == 0 || input.is_empty() {
            self.dropped_samples += input.len();
            return;
        }

        let required = self.samples.len() + input.len();
        if required > self.max_samples {
            let overflow = required - self.max_samples;
            let to_drop = overflow.min(self.samples.len());
            if to_drop > 0 {
                self.samples.drain(0..to_drop);
            }
            let remaining_overflow = overflow.saturating_sub(to_drop);
            self.dropped_samples += to_drop + remaining_overflow;
            if remaining_overflow > 0 {
                let start = remaining_overflow.min(input.len());
                self.samples.extend_from_slice(&input[start..]);
                return;
            }
        }
        self.samples.extend_from_slice(input);
    }

    pub fn samples(&self) -> &[f32] {
        &self.samples
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    pub fn dropped_samples(&self) -> usize {
        self.dropped_samples
    }
}

#[cfg(test)]
mod tests {
    use super::{BoundedPcmBuffer, RmsActivityGate};

    #[test]
    fn rms_gate_reports_activity() {
        let gate = RmsActivityGate::new(0.2);
        let quiet = gate.analyze(&[0.01, -0.01, 0.02, -0.02]);
        let active = gate.analyze(&[0.4, -0.4, 0.2, -0.2]);

        assert!(!quiet.active);
        assert!(active.active);
        assert!(active.rms > quiet.rms);
        assert_eq!(active.peak, 0.4);
    }

    #[test]
    fn bounded_buffer_keeps_latest_samples() {
        let mut buffer = BoundedPcmBuffer::new(4);
        buffer.push(&[0.1, 0.2, 0.3]);
        buffer.push(&[0.4, 0.5, 0.6]);

        assert_eq!(buffer.samples(), &[0.3, 0.4, 0.5, 0.6]);
        assert_eq!(buffer.len(), 4);
        assert_eq!(buffer.dropped_samples(), 2);
    }
}
