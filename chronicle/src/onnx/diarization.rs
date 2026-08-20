//! Pyannote segmentation combined with CAMPPlus speaker embeddings.

use std::path::Path;

#[cfg(feature = "sherpa-asr")]
use sherpa_onnx::{
    FastClusteringConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig,
    OfflineSpeakerSegmentationModelConfig, OfflineSpeakerSegmentationPyannoteModelConfig,
    SpeakerEmbeddingExtractorConfig,
};

use crate::error::{ChronicleError, ChronicleResult};

#[derive(Debug, Clone, PartialEq)]
pub struct DiarizationTurn {
    pub start_sample: usize,
    pub end_sample: usize,
    pub speaker: i32,
}

pub struct SpeakerDiarizer {
    #[cfg(feature = "sherpa-asr")]
    diarizer: OfflineSpeakerDiarization,
}

impl SpeakerDiarizer {
    pub fn new(segmentation_model: &Path, embedding_model: &Path) -> ChronicleResult<Self> {
        #[cfg(feature = "sherpa-asr")]
        {
            let config = OfflineSpeakerDiarizationConfig {
                segmentation: OfflineSpeakerSegmentationModelConfig {
                    pyannote: OfflineSpeakerSegmentationPyannoteModelConfig {
                        model: Some(segmentation_model.to_string_lossy().to_string()),
                    },
                    num_threads: 2,
                    debug: false,
                    provider: Some("cpu".to_string()),
                },
                embedding: SpeakerEmbeddingExtractorConfig {
                    model: Some(embedding_model.to_string_lossy().to_string()),
                    num_threads: 2,
                    debug: false,
                    provider: Some("cpu".to_string()),
                },
                clustering: FastClusteringConfig {
                    num_clusters: -1,
                    threshold: 0.72,
                },
                min_duration_on: 0.3,
                min_duration_off: 0.3,
            };
            let diarizer = OfflineSpeakerDiarization::create(&config).ok_or_else(|| {
                ChronicleError::Process(
                    "failed to initialize Pyannote+CAMPPlus diarization".to_string(),
                )
            })?;
            Ok(Self { diarizer })
        }

        #[cfg(not(feature = "sherpa-asr"))]
        {
            let _ = (segmentation_model, embedding_model);
            Err(ChronicleError::Process(
                "speaker diarization requires the sherpa-asr feature".to_string(),
            ))
        }
    }

    pub fn process(
        &self,
        samples: &[f32],
        sample_rate: u32,
    ) -> ChronicleResult<Vec<DiarizationTurn>> {
        #[cfg(feature = "sherpa-asr")]
        {
            let expected_rate = self.diarizer.sample_rate() as u32;
            if sample_rate != expected_rate {
                return Err(ChronicleError::InvalidArgument(format!(
                    "speaker diarization expects {expected_rate} Hz audio, got {sample_rate}"
                )));
            }
            let result = self.diarizer.process(samples).ok_or_else(|| {
                ChronicleError::Process("Pyannote+CAMPPlus diarization failed".to_string())
            })?;
            Ok(result
                .sort_by_start_time()
                .into_iter()
                .filter_map(|turn| {
                    let start_sample = (turn.start.max(0.0) * sample_rate as f32).round() as usize;
                    let end_sample = (turn.end.max(0.0) * sample_rate as f32).round() as usize;
                    (end_sample > start_sample).then_some(DiarizationTurn {
                        start_sample,
                        end_sample: end_sample.min(samples.len()),
                        speaker: turn.speaker,
                    })
                })
                .collect())
        }

        #[cfg(not(feature = "sherpa-asr"))]
        {
            let _ = (samples, sample_rate);
            Err(ChronicleError::Process(
                "speaker diarization requires the sherpa-asr feature".to_string(),
            ))
        }
    }
}
