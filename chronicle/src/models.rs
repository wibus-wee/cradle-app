//! Model management for Chronicle — delegates downloads to Cradle Server.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{ChronicleError, ChronicleResult};
use crate::integrations::cradle_server::cradle_base_url;

/// Known model identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModelId {
    SenseVoiceAsr,
    SileroVad,
    GlinerPii,
    OcrModel,
    EmbeddingModel,
    SpeakerEmbeddingExtractor,
}

impl ModelId {
    /// Map a model ID to its server category and relative file path within the models root.
    fn server_mapping(self) -> (&'static str, &'static str) {
        match self {
            ModelId::SileroVad => ("audio-vad", "audio-vad/silero_vad.onnx"),
            ModelId::SenseVoiceAsr => ("audio-asr", "audio-asr/sensevoice/model.int8.onnx"),
            ModelId::GlinerPii => ("pii", "pii/gliner-pii-basemodel.onnx"),
            ModelId::EmbeddingModel => ("embedding", "embedding/model.onnx"),
            ModelId::SpeakerEmbeddingExtractor => (
                "speaker",
                "speaker/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
            ),
            ModelId::OcrModel => ("ocr", "ocr/model.onnx"),
        }
    }

    /// The server category for this model.
    pub fn category(self) -> &'static str {
        self.server_mapping().0
    }

    /// Relative path from models root to the primary model file.
    pub fn relative_path(self) -> &'static str {
        self.server_mapping().1
    }
}

/// Status of a model on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelStatus {
    /// Model exists and is ready.
    Ready(PathBuf),
    /// Model is not available.
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModelInstallStrategy {
    LocalOnly,
    RequestServer,
}

/// Model cache manager — reads from server-managed model directory.
pub struct ModelManager {
    models_dir: PathBuf,
    install_strategy: ModelInstallStrategy,
}

impl ModelManager {
    /// Create a new model manager with the given models directory.
    pub fn new(cache_dir: impl Into<PathBuf>) -> Self {
        Self {
            models_dir: cache_dir.into(),
            install_strategy: ModelInstallStrategy::RequestServer,
        }
    }

    /// Create a model manager that never contacts Cradle Server.
    pub fn new_local_only(cache_dir: impl Into<PathBuf>) -> Self {
        Self {
            models_dir: cache_dir.into(),
            install_strategy: ModelInstallStrategy::LocalOnly,
        }
    }

    /// Create a model manager using the default server-managed directory.
    ///
    /// Uses `CRADLE_MODELS_DIR` env var if set, otherwise `~/.cradle/chronicle/models/`.
    pub fn from_default_dir() -> Self {
        let models_dir = if let Ok(dir) = std::env::var("CRADLE_MODELS_DIR") {
            PathBuf::from(dir)
        } else {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".cradle")
                .join("chronicle")
                .join("models")
        };
        Self::new(models_dir)
    }

    /// Create a default model manager for standalone local diagnostics.
    ///
    /// Uses the same directory resolution as `from_default_dir`, but does not request
    /// Server-side installs when a model is missing.
    pub fn from_default_dir_local_only() -> Self {
        let mut manager = Self::from_default_dir();
        manager.install_strategy = ModelInstallStrategy::LocalOnly;
        manager
    }

    /// Check the status of a model on disk.
    pub fn status(&self, model_id: ModelId) -> ModelStatus {
        let path = self.model_path(model_id);
        if path.exists() {
            ModelStatus::Ready(path)
        } else {
            ModelStatus::Missing
        }
    }

    /// Get the expected path for a model.
    pub fn model_path(&self, model_id: ModelId) -> PathBuf {
        self.models_dir.join(model_id.relative_path())
    }

    /// Ensure a model is available, requesting server install if missing.
    pub fn ensure_model(&self, model_id: ModelId) -> ChronicleResult<PathBuf> {
        let path = self.model_path(model_id);
        if path.exists() {
            return Ok(path);
        }

        if self.install_strategy == ModelInstallStrategy::LocalOnly {
            return Err(ChronicleError::Process(format!(
                "model {} is not installed at {}; install it with Cradle Server first or set CRADLE_MODELS_DIR to a directory containing {}",
                model_id.category(),
                path.display(),
                model_id.relative_path()
            )));
        }

        // Request server to install the model.
        self.request_server_install(model_id.category())?;

        // Verify it was installed.
        if path.exists() {
            Ok(path)
        } else {
            Err(ChronicleError::Process(format!(
                "model {:?} not found at {} after server install request",
                model_id,
                path.display()
            )))
        }
    }

    /// Ask Cradle Server to install a model category.
    fn request_server_install(&self, category: &str) -> ChronicleResult<()> {
        let url = format!(
            "{}/chronicle/model-resources/{}/install",
            cradle_base_url(),
            category
        );

        eprintln!("Requesting server to install model category: {category}");

        let response = ureq::post(&url)
            .header("Content-Type", "application/json")
            .config()
            .timeout_global(Some(Duration::from_secs(300)))
            .build()
            .send(br#"{"source":"manifest"}"#.as_slice())
            .map_err(|e| {
                ChronicleError::Process(format!(
                    "failed to request model install for {category}: {e}"
                ))
            })?;

        let status = response.status();
        if status != 200 {
            return Err(ChronicleError::Process(format!(
                "server returned status {status} for model install of {category}"
            )));
        }

        Ok(())
    }

    /// List models that exist on disk.
    pub fn list_cached(&self) -> Vec<(ModelId, PathBuf)> {
        let all = [
            ModelId::SileroVad,
            ModelId::SenseVoiceAsr,
            ModelId::GlinerPii,
            ModelId::EmbeddingModel,
            ModelId::SpeakerEmbeddingExtractor,
            ModelId::OcrModel,
        ];
        all.iter()
            .filter_map(|&id| {
                let path = self.model_path(id);
                if path.exists() {
                    Some((id, path))
                } else {
                    None
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn model_path_returns_correct_path() {
        let mgr = ModelManager::new("/tmp/test-models");
        let path = mgr.model_path(ModelId::SileroVad);
        assert_eq!(
            path,
            PathBuf::from("/tmp/test-models/audio-vad/silero_vad.onnx")
        );

        let speaker_path = mgr.model_path(ModelId::SpeakerEmbeddingExtractor);
        assert_eq!(
            speaker_path,
            PathBuf::from(
                "/tmp/test-models/speaker/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
            )
        );
    }

    #[test]
    fn status_returns_missing_for_nonexistent_model() {
        let mgr = ModelManager::new("/tmp/nonexistent-chronicle-models-test");
        assert_eq!(mgr.status(ModelId::SileroVad), ModelStatus::Missing);
    }

    #[test]
    fn local_only_missing_model_does_not_request_server() {
        let mgr = ModelManager::new_local_only("/tmp/nonexistent-chronicle-models-local-only-test");
        let error = mgr
            .ensure_model(ModelId::SpeakerEmbeddingExtractor)
            .unwrap_err();
        let message = error.to_string();
        assert!(message.contains("speaker"));
        assert!(message.contains("CRADLE_MODELS_DIR"));
        assert!(!message.contains("failed to request model install"));
    }

    #[test]
    fn from_default_dir_resolves_to_chronicle_models() {
        // When no env override, should resolve to ~/.cradle/chronicle/models/
        // (env var may or may not be set due to parallel test execution)
        unsafe { env::remove_var("CRADLE_MODELS_DIR") };
        let mgr = ModelManager::from_default_dir();
        let path_str = mgr.models_dir.to_string_lossy();
        assert!(
            path_str.ends_with(".cradle/chronicle/models") || path_str.starts_with("/tmp"),
            "unexpected default dir: {path_str}"
        );
    }

    #[test]
    fn list_cached_returns_empty_for_missing_dir() {
        let mgr = ModelManager::new("/tmp/nonexistent-chronicle-models-test");
        assert!(mgr.list_cached().is_empty());
    }

    #[test]
    fn model_id_category_mapping() {
        assert_eq!(ModelId::SileroVad.category(), "audio-vad");
        assert_eq!(ModelId::SenseVoiceAsr.category(), "audio-asr");
        assert_eq!(ModelId::GlinerPii.category(), "pii");
        assert_eq!(ModelId::EmbeddingModel.category(), "embedding");
        assert_eq!(ModelId::SpeakerEmbeddingExtractor.category(), "speaker");
    }
}
