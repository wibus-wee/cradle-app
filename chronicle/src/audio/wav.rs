//! WAV artifact writing for normalized Chronicle audio diagnostics.

use std::fs::{self, OpenOptions};
use std::io::{BufWriter, ErrorKind, Write};
use std::path::{Path, PathBuf};

use crate::error::{ChronicleError, ChronicleResult};
use crate::time::Timestamp;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WavArtifact {
    pub wav_path: PathBuf,
    pub metadata_path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioArtifactKind {
    Diagnostics,
    Segment,
}

impl AudioArtifactKind {
    fn directory(self) -> &'static str {
        match self {
            Self::Diagnostics => "diagnostics",
            Self::Segment => "segments",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioArtifactMetadata {
    pub recorded_at: Timestamp,
    pub source: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub source_sample_format: String,
    pub sample_count: usize,
    pub dropped_samples: usize,
    pub rms: f32,
    pub peak: f32,
    pub active: bool,
}

pub fn write_audio_diagnostics_artifact(
    storage_root: impl AsRef<Path>,
    samples: &[f32],
    metadata: &AudioArtifactMetadata,
) -> ChronicleResult<WavArtifact> {
    write_audio_artifact(
        storage_root,
        samples,
        metadata,
        AudioArtifactKind::Diagnostics,
    )
}

pub fn write_audio_segment_artifact(
    storage_root: impl AsRef<Path>,
    samples: &[f32],
    metadata: &AudioArtifactMetadata,
) -> ChronicleResult<WavArtifact> {
    write_audio_artifact(storage_root, samples, metadata, AudioArtifactKind::Segment)
}

fn write_audio_artifact(
    storage_root: impl AsRef<Path>,
    samples: &[f32],
    metadata: &AudioArtifactMetadata,
    kind: AudioArtifactKind,
) -> ChronicleResult<WavArtifact> {
    let audio_root = storage_root.as_ref().join("audio").join(kind.directory());
    fs::create_dir_all(&audio_root).map_err(|source| ChronicleError::io_at(&audio_root, source))?;

    write_unique_artifact(&audio_root, samples, metadata, kind)
}

fn write_unique_artifact(
    audio_root: &Path,
    samples: &[f32],
    metadata: &AudioArtifactMetadata,
    kind: AudioArtifactKind,
) -> ChronicleResult<WavArtifact> {
    let timestamp = metadata.recorded_at.filesystem();
    let pid = std::process::id();
    let metadata_body = metadata_json(metadata, kind);
    for sequence in 0..10_000_u32 {
        let base_name = format!(
            "{timestamp}-{pid}-{sequence:04}-{}",
            artifact_filename_suffix(metadata, kind)
        );
        let wav_path = audio_root.join(format!("{base_name}.wav"));
        let metadata_path = audio_root.join(format!("{base_name}.json"));
        match write_mono_i16_wav_exclusive(&wav_path, samples, metadata.sample_rate) {
            Ok(()) => match write_metadata_exclusive(&metadata_path, &metadata_body) {
                Ok(()) => {
                    return Ok(WavArtifact {
                        wav_path,
                        metadata_path,
                    });
                }
                Err(error) if is_already_exists(&error) => {
                    let _ = fs::remove_file(&wav_path);
                    continue;
                }
                Err(error) => {
                    let _ = fs::remove_file(&wav_path);
                    return Err(error);
                }
            },
            Err(error) if is_already_exists(&error) => continue,
            Err(error) => return Err(error),
        }
    }
    Err(ChronicleError::Process(format!(
        "failed to reserve audio diagnostic artifact path under {}",
        audio_root.display()
    )))
}

fn write_mono_i16_wav_exclusive(
    path: &Path,
    samples: &[f32],
    sample_rate: u32,
) -> ChronicleResult<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|source| ChronicleError::io_at(path, source))?;
    let mut writer = hound::WavWriter::new(BufWriter::new(file), spec)
        .map_err(|source| ChronicleError::Process(format!("failed to create WAV: {source}")))?;
    for sample in samples {
        writer
            .write_sample(float_to_i16(*sample))
            .map_err(|source| ChronicleError::Process(format!("failed to write WAV: {source}")))?;
    }
    writer
        .finalize()
        .map_err(|source| ChronicleError::Process(format!("failed to finalize WAV: {source}")))?;
    Ok(())
}

fn write_metadata_exclusive(path: &Path, body: &str) -> ChronicleResult<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|source| ChronicleError::io_at(path, source))?;
    file.write_all(body.as_bytes())
        .map_err(|source| ChronicleError::io_at(path, source))?;
    Ok(())
}

fn is_already_exists(error: &ChronicleError) -> bool {
    matches!(
        error,
        ChronicleError::Io {
            source,
            ..
        } if source.kind() == ErrorKind::AlreadyExists
    )
}

fn float_to_i16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    if clamped >= 0.0 {
        (clamped * i16::MAX as f32).round() as i16
    } else {
        (clamped * -(i16::MIN as f32)).round() as i16
    }
}

fn metadata_json(metadata: &AudioArtifactMetadata, kind: AudioArtifactKind) -> String {
    let pipeline_implemented = matches!(kind, AudioArtifactKind::Segment);
    serde_json::json!({
        "version": 1,
        "recordedAt": metadata.recorded_at.filesystem(),
        "sampleRate": metadata.sample_rate,
        "channels": metadata.channels,
        "sourceSampleFormat": metadata.source_sample_format,
        "sampleCount": metadata.sample_count,
        "droppedSamples": metadata.dropped_samples,
        "rms": metadata.rms,
        "peak": metadata.peak,
        "active": metadata.active,
        "runtime": artifact_runtime(metadata, kind),
        "source": metadata.source,
        "vadImplemented": pipeline_implemented,
        "asrImplemented": pipeline_implemented,
        "speakerLabelingImplemented": pipeline_implemented
    })
    .to_string()
}

fn artifact_filename_suffix(metadata: &AudioArtifactMetadata, kind: AudioArtifactKind) -> String {
    match kind {
        AudioArtifactKind::Diagnostics => "microphone-diagnostic".to_string(),
        AudioArtifactKind::Segment => {
            format!("{}-segment", sanitize_artifact_source(&metadata.source))
        }
    }
}

fn artifact_runtime(metadata: &AudioArtifactMetadata, kind: AudioArtifactKind) -> String {
    match kind {
        AudioArtifactKind::Diagnostics => "microphone-diagnostics".to_string(),
        AudioArtifactKind::Segment => {
            format!("{}-segment", sanitize_artifact_source(&metadata.source))
        }
    }
}

fn sanitize_artifact_source(source: &str) -> String {
    let normalized = source
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        "audio".to_string()
    } else {
        normalized.to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::audio::wav::{
        AudioArtifactMetadata, write_audio_diagnostics_artifact, write_audio_segment_artifact,
    };
    use crate::time::Timestamp;

    #[test]
    fn writes_wav_and_metadata_artifacts() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-audio-wav-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let metadata = AudioArtifactMetadata {
            recorded_at: Timestamp::from_seconds(1_779_125_791),
            source: "microphone".to_string(),
            sample_rate: 16_000,
            channels: 1,
            source_sample_format: "f32".to_string(),
            sample_count: 4,
            dropped_samples: 0,
            rms: 0.5,
            peak: 0.9,
            active: true,
        };

        let artifact = write_audio_diagnostics_artifact(&root, &[0.0, 0.5, -0.5, 1.0], &metadata)
            .expect("audio artifact should write");

        assert!(artifact.wav_path.exists());
        assert!(artifact.metadata_path.exists());
        let json = fs::read_to_string(artifact.metadata_path).expect("metadata should read");
        assert!(json.contains("\"runtime\":\"microphone-diagnostics\""));
        assert!(json.contains("\"asrImplemented\":false"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn writes_segment_artifact_under_segments_directory() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-audio-segment-wav-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let metadata = AudioArtifactMetadata {
            recorded_at: Timestamp::from_seconds(1_779_125_791),
            source: "system".to_string(),
            sample_rate: 16_000,
            channels: 1,
            source_sample_format: "f32".to_string(),
            sample_count: 2,
            dropped_samples: 0,
            rms: 0.25,
            peak: 0.5,
            active: true,
        };

        let artifact = write_audio_segment_artifact(&root, &[0.25, -0.25], &metadata)
            .expect("audio segment artifact should write");

        assert!(artifact.wav_path.to_string_lossy().contains("/segments/"));
        assert!(
            artifact
                .wav_path
                .to_string_lossy()
                .contains("system-segment")
        );
        let json = fs::read_to_string(artifact.metadata_path).expect("metadata should read");
        assert!(json.contains("\"runtime\":\"system-segment\""));
        assert!(json.contains("\"source\":\"system\""));
        assert!(json.contains("\"vadImplemented\":true"));
        assert!(json.contains("\"asrImplemented\":true"));
        assert!(json.contains("\"speakerLabelingImplemented\":true"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn repeated_same_second_writes_do_not_overwrite_artifacts() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-audio-wav-collision-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let metadata = AudioArtifactMetadata {
            recorded_at: Timestamp::from_seconds(1_779_125_791),
            source: "microphone".to_string(),
            sample_rate: 16_000,
            channels: 1,
            source_sample_format: "f32".to_string(),
            sample_count: 2,
            dropped_samples: 0,
            rms: 0.3,
            peak: 0.4,
            active: true,
        };

        let first = write_audio_diagnostics_artifact(&root, &[0.1, 0.2], &metadata)
            .expect("first audio artifact should write");
        let second = write_audio_diagnostics_artifact(&root, &[0.3, 0.4], &metadata)
            .expect("second audio artifact should write");

        assert_ne!(first.wav_path, second.wav_path);
        assert_ne!(first.metadata_path, second.metadata_path);
        assert!(first.wav_path.exists());
        assert!(first.metadata_path.exists());
        assert!(second.wav_path.exists());
        assert!(second.metadata_path.exists());

        let audio_root = root.join("audio/diagnostics");
        let artifact_count = fs::read_dir(&audio_root)
            .expect("audio root should read")
            .filter_map(Result::ok)
            .count();
        assert_eq!(artifact_count, 4);

        let _ = fs::remove_dir_all(&root);
    }
}
