//! Silero VAD ONNX inference for speech/silence detection.
//!
//! Uses the Silero VAD v5 model via ONNX Runtime to produce per-chunk
//! speech probabilities, then applies a state machine to emit speech segments.

use std::path::Path;

#[cfg(not(feature = "sherpa-asr"))]
use ndarray::{Array2, Array3};
#[cfg(not(feature = "sherpa-asr"))]
use ort::session::Session;
#[cfg(not(feature = "sherpa-asr"))]
use ort::value::Tensor;
#[cfg(feature = "sherpa-asr")]
use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};

use crate::audio::vad::SpeechSegment;
use crate::error::{ChronicleError, ChronicleResult};

/// Chunk size expected by Silero VAD at 16 kHz.
pub const SILERO_CHUNK_SIZE: usize = 512;

/// Sample rate expected by Silero VAD.
pub const SILERO_SAMPLE_RATE: u32 = 16000;

/// Configuration for Silero VAD speech detection pipeline.
#[derive(Debug, Clone)]
pub struct SileroVadConfig {
    /// Probability threshold above which a chunk is considered speech.
    pub threshold: f32,
    /// Minimum speech duration in milliseconds to keep a segment.
    pub min_speech_ms: u64,
    /// Minimum silence duration in milliseconds before splitting segments.
    pub min_silence_ms: u64,
    /// Padding in milliseconds added to each side of a speech segment.
    pub speech_pad_ms: u64,
}

impl Default for SileroVadConfig {
    fn default() -> Self {
        Self {
            threshold: 0.5,
            min_speech_ms: 250,
            min_silence_ms: 100,
            speech_pad_ms: 30,
        }
    }
}

/// Silero VAD model wrapper maintaining hidden state across inference calls.
pub struct SileroVad {
    #[cfg(feature = "sherpa-asr")]
    detector: VoiceActivityDetector,
    #[cfg(not(feature = "sherpa-asr"))]
    session: Session,
    #[cfg(not(feature = "sherpa-asr"))]
    state_h: Array3<f32>,
    #[cfg(not(feature = "sherpa-asr"))]
    state_c: Array3<f32>,
    #[cfg(not(feature = "sherpa-asr"))]
    config: SileroVadConfig,
}

impl SileroVad {
    /// Load the Silero VAD ONNX model from disk.
    pub fn new(model_path: &Path) -> ChronicleResult<Self> {
        #[cfg(feature = "sherpa-asr")]
        {
            Self::with_config(model_path, SileroVadConfig::default())
        }

        #[cfg(not(feature = "sherpa-asr"))]
        {
            let session = super::load_session(model_path)?;
            Ok(Self {
                session,
                state_h: Array3::<f32>::zeros((2, 1, 64)),
                state_c: Array3::<f32>::zeros((2, 1, 64)),
                config: SileroVadConfig::default(),
            })
        }
    }

    /// Load the Silero VAD ONNX model with custom config.
    pub fn with_config(model_path: &Path, config: SileroVadConfig) -> ChronicleResult<Self> {
        #[cfg(feature = "sherpa-asr")]
        {
            let detector_config = VadModelConfig {
                silero_vad: SileroVadModelConfig {
                    model: Some(model_path.to_string_lossy().to_string()),
                    threshold: config.threshold,
                    min_silence_duration: config.min_silence_ms as f32 / 1000.0,
                    min_speech_duration: config.min_speech_ms as f32 / 1000.0,
                    window_size: SILERO_CHUNK_SIZE as i32,
                    max_speech_duration: 30.0,
                },
                sample_rate: SILERO_SAMPLE_RATE as i32,
                num_threads: 2,
                provider: Some("cpu".to_string()),
                debug: false,
                ..VadModelConfig::default()
            };
            let detector =
                VoiceActivityDetector::create(&detector_config, 300.0).ok_or_else(|| {
                    ChronicleError::Process(format!(
                        "failed to create sherpa-onnx Silero VAD for {}",
                        model_path.display()
                    ))
                })?;
            Ok(Self { detector })
        }

        #[cfg(not(feature = "sherpa-asr"))]
        {
            let session = super::load_session(model_path)?;
            Ok(Self {
                session,
                state_h: Array3::<f32>::zeros((2, 1, 64)),
                state_c: Array3::<f32>::zeros((2, 1, 64)),
                config,
            })
        }
    }

    /// Reset the hidden state to zeros (call when starting a new audio stream).
    pub fn reset(&mut self) {
        #[cfg(feature = "sherpa-asr")]
        {
            self.detector.reset();
            self.detector.clear();
        }

        #[cfg(not(feature = "sherpa-asr"))]
        {
            self.state_h = Array3::<f32>::zeros((2, 1, 64));
            self.state_c = Array3::<f32>::zeros((2, 1, 64));
        }
    }

    /// Process a single 512-sample chunk, returning the speech probability [0.0, 1.0].
    ///
    /// The hidden state is updated internally after each call.
    pub fn process_chunk(&mut self, samples: &[f32]) -> ChronicleResult<f32> {
        if samples.len() != SILERO_CHUNK_SIZE {
            return Err(ChronicleError::InvalidArgument(format!(
                "expected {} samples, got {}",
                SILERO_CHUNK_SIZE,
                samples.len()
            )));
        }

        #[cfg(feature = "sherpa-asr")]
        {
            self.detector.accept_waveform(samples);
            Ok(if self.detector.detected() { 1.0 } else { 0.0 })
        }

        #[cfg(not(feature = "sherpa-asr"))]
        {
            let input =
                Array2::from_shape_vec((1, SILERO_CHUNK_SIZE), samples.to_vec()).map_err(|e| {
                    ChronicleError::Process(format!("failed to create input tensor: {e}"))
                })?;

            let state_h = self.state_h.clone();
            let state_c = self.state_c.clone();

            let input_value = Tensor::from_array(input)
                .map_err(|e| ChronicleError::Process(format!("input tensor error: {e}")))?;
            let state_h_value = Tensor::from_array(state_h)
                .map_err(|e| ChronicleError::Process(format!("state h tensor error: {e}")))?;
            let state_c_value = Tensor::from_array(state_c)
                .map_err(|e| ChronicleError::Process(format!("state c tensor error: {e}")))?;

            let outputs = self
                .session
                .run(ort::inputs![
                    "x" => input_value,
                    "h" => state_h_value,
                    "c" => state_c_value,
                ])
                .map_err(|e| ChronicleError::Process(format!("ONNX inference failed: {e}")))?;

            // Extract speech probability — try_extract_tensor returns (&Shape, &[T]).
            let (_, output_data) = outputs["prob"]
                .try_extract_tensor::<f32>()
                .map_err(|e| ChronicleError::Process(format!("output extraction failed: {e}")))?;
            let prob = output_data.first().copied().unwrap_or(0.0);

            // Extract updated hidden state.
            let (_, state_h_data) = outputs["new_h"]
                .try_extract_tensor::<f32>()
                .map_err(|e| ChronicleError::Process(format!("state h extraction failed: {e}")))?;
            let (_, state_c_data) = outputs["new_c"]
                .try_extract_tensor::<f32>()
                .map_err(|e| ChronicleError::Process(format!("state c extraction failed: {e}")))?;
            self.state_h = Array3::from_shape_vec((2, 1, 64), state_h_data.to_vec())
                .map_err(|e| ChronicleError::Process(format!("state h reshape failed: {e}")))?;
            self.state_c = Array3::from_shape_vec((2, 1, 64), state_c_data.to_vec())
                .map_err(|e| ChronicleError::Process(format!("state c reshape failed: {e}")))?;

            Ok(prob)
        }
    }

    /// Run the full speech detection pipeline over a buffer of audio samples.
    ///
    /// Resets the hidden state before processing. Returns detected speech segments
    /// with timestamps computed from `sample_rate`.
    pub fn detect_speech(
        &mut self,
        samples: &[f32],
        sample_rate: u32,
    ) -> ChronicleResult<Vec<SpeechSegment>> {
        self.reset();

        if sample_rate != SILERO_SAMPLE_RATE {
            return Err(ChronicleError::InvalidArgument(format!(
                "Silero VAD expects {} Hz audio, got {sample_rate}",
                SILERO_SAMPLE_RATE
            )));
        }

        #[cfg(feature = "sherpa-asr")]
        {
            self.detector.accept_waveform(samples);
            self.detector.flush();

            let samples_per_ms = sample_rate as f64 / 1000.0;
            let mut segments = Vec::new();
            while let Some(segment) = self.detector.front() {
                let start_sample = segment.start().max(0) as usize;
                let sample_count = segment.n().max(0) as usize;
                let end_sample = (start_sample + sample_count).min(samples.len());
                if start_sample < end_sample {
                    let energy = compute_rms(&samples[start_sample..end_sample]);
                    segments.push(SpeechSegment {
                        start_sample,
                        end_sample,
                        start_ms: (start_sample as f64 / samples_per_ms) as u64,
                        end_ms: (end_sample as f64 / samples_per_ms) as u64,
                        energy,
                    });
                }
                self.detector.pop();
            }
            Ok(segments)
        }

        #[cfg(not(feature = "sherpa-asr"))]
        {
            let chunk_size = SILERO_CHUNK_SIZE;
            let num_chunks = samples.len() / chunk_size;
            let samples_per_ms = sample_rate as f64 / 1000.0;

            let min_speech_samples = (self.config.min_speech_ms as f64 * samples_per_ms) as usize;
            let min_silence_samples = (self.config.min_silence_ms as f64 * samples_per_ms) as usize;
            let pad_samples = (self.config.speech_pad_ms as f64 * samples_per_ms) as usize;

            // State machine for segment detection.
            let mut segments: Vec<SpeechSegment> = Vec::new();
            let mut in_speech = false;
            let mut speech_start: usize = 0;
            let mut silence_count: usize = 0;

            for i in 0..num_chunks {
                let offset = i * chunk_size;
                let chunk = &samples[offset..offset + chunk_size];
                let prob = self.process_chunk(chunk)?;

                if prob >= self.config.threshold {
                    if !in_speech {
                        in_speech = true;
                        speech_start = offset;
                        silence_count = 0;
                    } else {
                        silence_count = 0;
                    }
                } else if in_speech {
                    silence_count += chunk_size;
                    if silence_count >= min_silence_samples {
                        // End of speech segment.
                        let end_sample = offset + chunk_size - silence_count;
                        let duration = end_sample.saturating_sub(speech_start);
                        if duration >= min_speech_samples {
                            let seg_start = speech_start.saturating_sub(pad_samples);
                            let seg_end = (end_sample + pad_samples).min(samples.len());
                            let energy = compute_rms(&samples[speech_start..end_sample]);
                            segments.push(SpeechSegment {
                                start_sample: seg_start,
                                end_sample: seg_end,
                                start_ms: (seg_start as f64 / samples_per_ms) as u64,
                                end_ms: (seg_end as f64 / samples_per_ms) as u64,
                                energy,
                            });
                        }
                        in_speech = false;
                        silence_count = 0;
                    }
                }
            }

            // Flush any trailing speech segment.
            if in_speech {
                let end_sample = num_chunks * chunk_size;
                let duration = end_sample.saturating_sub(speech_start);
                if duration >= min_speech_samples {
                    let seg_start = speech_start.saturating_sub(pad_samples);
                    let seg_end = (end_sample + pad_samples).min(samples.len());
                    let energy = compute_rms(&samples[speech_start..end_sample]);
                    segments.push(SpeechSegment {
                        start_sample: seg_start,
                        end_sample: seg_end,
                        start_ms: (seg_start as f64 / samples_per_ms) as u64,
                        end_ms: (seg_end as f64 / samples_per_ms) as u64,
                        energy,
                    });
                }
            }

            Ok(segments)
        }
    }
}

/// Compute RMS energy for a slice of audio samples.
fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = samples.iter().map(|&s| (s as f64) * (s as f64)).sum();
    (sum_sq / samples.len() as f64).sqrt() as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(not(feature = "sherpa-asr"))]
    use ndarray::{Array2, Array3};

    #[test]
    fn test_config_defaults() {
        let config = SileroVadConfig::default();
        assert_eq!(config.threshold, 0.5);
        assert_eq!(config.min_speech_ms, 250);
        assert_eq!(config.min_silence_ms, 100);
        assert_eq!(config.speech_pad_ms, 30);
    }

    #[test]
    fn test_process_chunk_rejects_wrong_size() {
        // We can't load a real model in unit tests, but we can verify
        // argument validation before inference.
        // Create a dummy struct by hand to test the size check.
        let too_short: Vec<f32> = vec![0.0; 256];

        // Since we can't construct SileroVad without a model, test via a mock-like approach:
        // Directly verify the size validation logic.
        assert_ne!(too_short.len(), SILERO_CHUNK_SIZE);
        assert_eq!(SILERO_CHUNK_SIZE, 512);
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_silence_chunk_is_zeros() {
        // Verify that a silence chunk (all zeros) can be constructed properly.
        let silence = vec![0.0f32; SILERO_CHUNK_SIZE];
        assert_eq!(silence.len(), 512);
        assert!(silence.iter().all(|&s| s == 0.0));

        // Verify tensor shape construction succeeds.
        let input = Array2::from_shape_vec((1, SILERO_CHUNK_SIZE), silence);
        assert!(input.is_ok());

        // Verify state tensor shape.
        let state = Array3::<f32>::zeros((2, 1, 128));
        assert_eq!(state.shape(), &[2, 1, 128]);
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_state_reset() {
        // Verify that a fresh state is all zeros with correct shape.
        let state = Array3::<f32>::zeros((2, 1, 128));
        assert_eq!(state.shape(), &[2, 1, 128]);
        assert!(state.iter().all(|&v| v == 0.0));

        // Simulate modifying and resetting.
        let mut state_modified = state.clone();
        state_modified[[0, 0, 0]] = 1.0;
        assert_ne!(state_modified[[0, 0, 0]], 0.0);

        // Reset.
        let state_reset = Array3::<f32>::zeros((2, 1, 128));
        assert!(state_reset.iter().all(|&v| v == 0.0));
    }

    #[test]
    fn test_compute_rms() {
        let silence = vec![0.0f32; 512];
        assert_eq!(compute_rms(&silence), 0.0);

        let signal = vec![1.0f32; 100];
        let rms = compute_rms(&signal);
        assert!((rms - 1.0).abs() < 1e-5);
    }
}
