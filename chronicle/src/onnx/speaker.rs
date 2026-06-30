//! 3D-Speaker CAMPPlus speaker embedding ONNX inference.

use std::path::Path;

#[cfg(not(feature = "sherpa-asr"))]
use ndarray::Axis;
#[cfg(not(feature = "sherpa-asr"))]
use ort::session::Session;
#[cfg(not(feature = "sherpa-asr"))]
use ort::value::Tensor;
#[cfg(feature = "sherpa-asr")]
use sherpa_onnx::{
    SpeakerEmbeddingExtractor as SherpaSpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig,
};

use crate::error::{ChronicleError, ChronicleResult};

#[cfg(not(feature = "sherpa-asr"))]
use super::asr::{FbankConfig, extract_fbank};

const MODEL_ID: &str = "3dspeaker-campplus-zh-en-16k";
const MODEL_VERSION: &str = "3dspeaker-campplus-zh-en-16k-common-advanced";

/// Speaker embedding extracted from one speech segment.
#[derive(Debug, Clone, PartialEq)]
pub struct SpeakerEmbedding {
    pub model_id: &'static str,
    pub model_version: &'static str,
    pub dimensions: usize,
    pub vector: Vec<f32>,
}

/// ONNX speaker embedding extractor.
pub struct SpeakerEmbeddingExtractor {
    #[cfg(feature = "sherpa-asr")]
    extractor: SherpaSpeakerEmbeddingExtractor,
    #[cfg(not(feature = "sherpa-asr"))]
    session: Session,
    #[cfg(not(feature = "sherpa-asr"))]
    fbank_config: FbankConfig,
    dimensions: usize,
}

impl SpeakerEmbeddingExtractor {
    pub fn new(model_path: &Path) -> ChronicleResult<Self> {
        #[cfg(feature = "sherpa-asr")]
        {
            let config = SpeakerEmbeddingExtractorConfig {
                model: Some(model_path.to_string_lossy().to_string()),
                num_threads: 2,
                debug: false,
                provider: Some("cpu".to_string()),
            };
            let extractor = SherpaSpeakerEmbeddingExtractor::create(&config).ok_or_else(|| {
                ChronicleError::Process(format!(
                    "failed to create sherpa-onnx speaker embedding extractor for {}",
                    model_path.display()
                ))
            })?;
            let dimensions = extractor.dim() as usize;
            Ok(Self {
                extractor,
                dimensions,
            })
        }

        #[cfg(not(feature = "sherpa-asr"))]
        {
            let session = super::load_session(model_path)?;
            Ok(Self {
                session,
                fbank_config: FbankConfig::default(),
                dimensions: 192,
            })
        }
    }

    pub fn dim(&self) -> usize {
        self.dimensions
    }

    /// Extract a normalized speaker embedding from 16 kHz mono PCM samples.
    pub fn embed(
        &mut self,
        samples: &[f32],
        sample_rate: u32,
    ) -> ChronicleResult<SpeakerEmbedding> {
        let expected_sample_rate = 16_000;
        if sample_rate != expected_sample_rate {
            return Err(ChronicleError::InvalidArgument(format!(
                "speaker embedding expects {expected_sample_rate} Hz audio, got {sample_rate}"
            )));
        }
        if samples.is_empty() {
            return Err(ChronicleError::InvalidArgument(
                "speaker embedding requires non-empty audio".to_string(),
            ));
        }

        #[cfg(feature = "sherpa-asr")]
        {
            let stream = self.extractor.create_stream().ok_or_else(|| {
                ChronicleError::Process("failed to create sherpa-onnx speaker stream".to_string())
            })?;
            stream.accept_waveform(sample_rate as i32, samples);
            stream.input_finished();
            if !self.extractor.is_ready(&stream) {
                return Err(ChronicleError::Process(
                    "speaker embedding extractor needs more speech samples".to_string(),
                ));
            }
            let mut vector = self.extractor.compute(&stream).ok_or_else(|| {
                ChronicleError::Process("sherpa-onnx speaker embedding failed".to_string())
            })?;
            normalize_l2(&mut vector)?;
            self.dimensions = vector.len();
            Ok(SpeakerEmbedding {
                model_id: MODEL_ID,
                model_version: MODEL_VERSION,
                dimensions: vector.len(),
                vector,
            })
        }

        #[cfg(not(feature = "sherpa-asr"))]
        {
            let features = extract_fbank(samples, &self.fbank_config)?;
            let input = features.insert_axis(Axis(0));
            let input_tensor = Tensor::from_array(input)
                .map_err(|error| ChronicleError::Process(format!("speaker tensor: {error}")))?;

            let outputs = self
                .session
                .run(ort::inputs!["x" => input_tensor])
                .map_err(|error| {
                    ChronicleError::Process(format!("speaker ONNX run failed: {error}"))
                })?;

            let (shape, embedding_data) =
                outputs[0].try_extract_tensor::<f32>().map_err(|error| {
                    ChronicleError::Process(format!("extract speaker embedding: {error}"))
                })?;
            if shape.len() != 2 {
                return Err(ChronicleError::Process(format!(
                    "speaker embedding expected rank 2 output, got shape {shape:?}"
                )));
            }

            let dimensions = shape[1] as usize;
            let mut vector = embedding_data[..dimensions].to_vec();
            normalize_l2(&mut vector)?;
            self.dimensions = dimensions;

            Ok(SpeakerEmbedding {
                model_id: MODEL_ID,
                model_version: MODEL_VERSION,
                dimensions,
                vector,
            })
        }
    }
}

fn normalize_l2(vector: &mut [f32]) -> ChronicleResult<()> {
    let norm = vector
        .iter()
        .map(|value| (*value as f64) * (*value as f64))
        .sum::<f64>()
        .sqrt();
    if !norm.is_finite() || norm <= f64::EPSILON {
        return Err(ChronicleError::Process(
            "speaker embedding norm is zero or non-finite".to_string(),
        ));
    }
    for value in vector {
        *value = (*value as f64 / norm) as f32;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize_l2;

    #[test]
    fn normalizes_vector_to_unit_length() {
        let mut vector = vec![3.0, 4.0];
        normalize_l2(&mut vector).expect("vector should normalize");
        let norm = vector
            .iter()
            .map(|value| (*value as f64) * (*value as f64))
            .sum::<f64>()
            .sqrt();
        assert!((norm - 1.0).abs() < 0.000001);
    }
}
