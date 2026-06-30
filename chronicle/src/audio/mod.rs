//! Local audio capture foundations for Chronicle runtime diagnostics.

pub mod activity;
pub mod asr;
pub mod capture;
pub mod vad;
pub mod wav;

pub use activity::{AudioActivityReport, BoundedPcmBuffer, RmsActivityGate};
pub use asr::{
    LocalTranscriptionPipeline, TranscriptionPipelineOutput, TranscriptionResult,
    TranscriptionRuntime, TranscriptionSegment, WhisperCliAsr,
};
pub use capture::{
    AudioDiagnosticsReport, MicrophoneCaptureReport, capture_microphone_samples,
    capture_mixed_audio_samples, capture_system_audio_samples, record_microphone_diagnostics,
};
pub use vad::{EnergyVad, SpeechSegment, VadConfig};
pub use wav::{AudioArtifactMetadata, WavArtifact, write_audio_segment_artifact};
