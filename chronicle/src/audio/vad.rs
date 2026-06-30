//! Voice Activity Detection for Chronicle audio streams.

/// A detected speech segment with start/end sample offsets.
#[derive(Debug, Clone, PartialEq)]
pub struct SpeechSegment {
    pub start_sample: usize,
    pub end_sample: usize,
    pub start_ms: u64,
    pub end_ms: u64,
    pub energy: f32,
}

/// Configuration for the energy-based VAD.
#[derive(Debug, Clone)]
pub struct VadConfig {
    /// RMS threshold above which a frame is considered speech.
    pub energy_threshold: f32,
    /// Minimum speech duration in milliseconds to keep.
    pub min_speech_ms: u64,
    /// Maximum silence within speech before splitting (ms).
    pub max_silence_ms: u64,
    /// Frame size in samples for analysis.
    pub frame_size: usize,
    /// Sample rate.
    pub sample_rate: u32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            energy_threshold: 0.01,
            min_speech_ms: 250,
            max_silence_ms: 500,
            frame_size: 480, // 30ms at 16kHz
            sample_rate: 16000,
        }
    }
}

/// Energy-based Voice Activity Detector.
/// No external model needed — uses RMS energy and a simple state machine.
pub struct EnergyVad {
    config: VadConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VadState {
    Silence,
    Speech,
}

impl EnergyVad {
    pub fn new(config: VadConfig) -> Self {
        Self { config }
    }

    /// Process audio samples and return detected speech segments.
    pub fn detect(&self, samples: &[f32]) -> Vec<SpeechSegment> {
        if samples.is_empty() {
            return Vec::new();
        }

        let frame_size = self.config.frame_size;
        let sample_rate = self.config.sample_rate as f64;
        let ms_per_sample = 1000.0 / sample_rate;
        let max_silence_samples = (self.config.max_silence_ms as f64 / ms_per_sample) as usize;

        let mut state = VadState::Silence;
        let mut segments: Vec<SpeechSegment> = Vec::new();
        let mut speech_start: usize = 0;
        let mut silence_count: usize = 0;
        let mut speech_energy_sum: f64 = 0.0;
        let mut speech_frame_count: usize = 0;

        let num_frames = samples.len() / frame_size;

        for i in 0..num_frames {
            let frame_start = i * frame_size;
            let frame_end = frame_start + frame_size;
            let frame = &samples[frame_start..frame_end];

            let rms = Self::compute_rms(frame);
            let is_speech = rms >= self.config.energy_threshold;

            match state {
                VadState::Silence => {
                    if is_speech {
                        state = VadState::Speech;
                        speech_start = frame_start;
                        silence_count = 0;
                        speech_energy_sum = rms as f64;
                        speech_frame_count = 1;
                    }
                }
                VadState::Speech => {
                    if is_speech {
                        silence_count = 0;
                        speech_energy_sum += rms as f64;
                        speech_frame_count += 1;
                    } else {
                        silence_count += frame_size;
                        if silence_count >= max_silence_samples {
                            // End of speech segment
                            let end_sample = frame_start - silence_count + frame_size;
                            self.maybe_push_segment(
                                &mut segments,
                                speech_start,
                                end_sample,
                                speech_energy_sum,
                                speech_frame_count,
                                ms_per_sample,
                            );
                            state = VadState::Silence;
                        }
                    }
                }
            }
        }

        // Flush any trailing speech (trim trailing silence)
        if state == VadState::Speech {
            let end_sample = num_frames * frame_size - silence_count;
            self.maybe_push_segment(
                &mut segments,
                speech_start,
                end_sample,
                speech_energy_sum,
                speech_frame_count,
                ms_per_sample,
            );
        }

        segments
    }

    /// Extract audio samples for a detected speech segment.
    pub fn extract_segment<'a>(&self, samples: &'a [f32], segment: &SpeechSegment) -> &'a [f32] {
        let start = segment.start_sample.min(samples.len());
        let end = segment.end_sample.min(samples.len());
        &samples[start..end]
    }

    fn compute_rms(frame: &[f32]) -> f32 {
        if frame.is_empty() {
            return 0.0;
        }
        let sum: f64 = frame.iter().map(|&s| (s as f64) * (s as f64)).sum();
        (sum / frame.len() as f64).sqrt() as f32
    }

    fn maybe_push_segment(
        &self,
        segments: &mut Vec<SpeechSegment>,
        start_sample: usize,
        end_sample: usize,
        energy_sum: f64,
        frame_count: usize,
        ms_per_sample: f64,
    ) {
        let duration_ms = ((end_sample - start_sample) as f64 * ms_per_sample) as u64;
        if duration_ms >= self.config.min_speech_ms {
            let avg_energy = if frame_count > 0 {
                (energy_sum / frame_count as f64) as f32
            } else {
                0.0
            };
            segments.push(SpeechSegment {
                start_sample,
                end_sample,
                start_ms: (start_sample as f64 * ms_per_sample) as u64,
                end_ms: (end_sample as f64 * ms_per_sample) as u64,
                energy: avg_energy,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generate_tone(
        sample_rate: u32,
        duration_ms: u64,
        frequency: f32,
        amplitude: f32,
    ) -> Vec<f32> {
        let num_samples = (sample_rate as u64 * duration_ms / 1000) as usize;
        (0..num_samples)
            .map(|i| {
                let t = i as f32 / sample_rate as f32;
                amplitude * (2.0 * std::f32::consts::PI * frequency * t).sin()
            })
            .collect()
    }

    fn generate_silence(sample_rate: u32, duration_ms: u64) -> Vec<f32> {
        let num_samples = (sample_rate as u64 * duration_ms / 1000) as usize;
        vec![0.0; num_samples]
    }

    #[test]
    fn detects_speech_in_synthetic_audio() {
        let config = VadConfig::default();
        let vad = EnergyVad::new(config);

        // silence (500ms) + tone (1000ms) + silence (500ms)
        let mut samples = generate_silence(16000, 500);
        samples.extend(generate_tone(16000, 1000, 440.0, 0.5));
        samples.extend(generate_silence(16000, 500));

        let segments = vad.detect(&samples);
        assert_eq!(segments.len(), 1);

        let seg = &segments[0];
        // Speech should start around 500ms and end around 1500ms
        assert!(
            seg.start_ms >= 450 && seg.start_ms <= 550,
            "start_ms={}",
            seg.start_ms
        );
        assert!(
            seg.end_ms >= 1450 && seg.end_ms <= 1550,
            "end_ms={}",
            seg.end_ms
        );
        assert!(seg.energy > 0.0);
    }

    #[test]
    fn respects_min_speech_ms_threshold() {
        let config = VadConfig {
            min_speech_ms: 500,
            ..VadConfig::default()
        };
        let vad = EnergyVad::new(config);

        // Short burst (100ms) that should be filtered out
        let mut samples = generate_silence(16000, 500);
        samples.extend(generate_tone(16000, 100, 440.0, 0.5));
        samples.extend(generate_silence(16000, 500));

        let segments = vad.detect(&samples);
        assert!(
            segments.is_empty(),
            "short segment should be filtered: {:?}",
            segments
        );
    }

    #[test]
    fn handles_all_silence() {
        let config = VadConfig::default();
        let vad = EnergyVad::new(config);

        let samples = generate_silence(16000, 3000);
        let segments = vad.detect(&samples);
        assert!(segments.is_empty());
    }

    #[test]
    fn handles_all_speech() {
        let config = VadConfig::default();
        let vad = EnergyVad::new(config);

        let samples = generate_tone(16000, 2000, 440.0, 0.5);
        let segments = vad.detect(&samples);
        assert_eq!(segments.len(), 1);

        let seg = &segments[0];
        assert_eq!(seg.start_sample, 0);
        assert!(seg.end_ms >= 1900, "end_ms={}", seg.end_ms);
    }

    #[test]
    fn detects_multiple_segments() {
        let config = VadConfig::default();
        let vad = EnergyVad::new(config);

        // tone (500ms) + long silence (1000ms) + tone (500ms)
        let mut samples = generate_tone(16000, 500, 440.0, 0.5);
        samples.extend(generate_silence(16000, 1000));
        samples.extend(generate_tone(16000, 500, 440.0, 0.5));

        let segments = vad.detect(&samples);
        assert_eq!(segments.len(), 2, "segments: {:?}", segments);
    }

    #[test]
    fn extract_segment_returns_correct_slice() {
        let config = VadConfig::default();
        let vad = EnergyVad::new(config);

        let samples: Vec<f32> = (0..1000).map(|i| i as f32 / 1000.0).collect();
        let segment = SpeechSegment {
            start_sample: 100,
            end_sample: 500,
            start_ms: 6,
            end_ms: 31,
            energy: 0.1,
        };

        let extracted = vad.extract_segment(&samples, &segment);
        assert_eq!(extracted.len(), 400);
        assert_eq!(extracted[0], samples[100]);
    }
}
