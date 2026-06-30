//! Unified ONNX model runtime - lazy initialization of all local models.

use std::cell::{OnceCell, RefCell};
use std::path::{Path, PathBuf};

use crate::error::{ChronicleError, ChronicleResult};
use crate::models::{ModelId, ModelManager};

use super::asr::SenseVoiceAsr;
use super::embedding::OnnxEmbeddingModel;
use super::pii::GlinerPiiDetector;
use super::speaker::SpeakerEmbeddingExtractor;
use super::vad::SileroVad;

/// Expected companion file paths for each model (server installs these with the model).
const SENSEVOICE_TOKENS: &str = "audio-asr/sensevoice/tokens.txt";
const EMBEDDING_TOKENIZER: &str = "embedding/tokenizer.json";
const GLINER_TOKENIZER: &str = "pii/tokenizer.json";

/// Unified runtime holding all ONNX model instances.
///
/// Single-threaded: uses `RefCell` for interior mutability since ONNX Session::run needs `&mut`.
/// Models are lazily initialized on first use.
pub struct OnnxRuntime {
    model_manager: ModelManager,
    vad: OnceCell<RefCell<SileroVad>>,
    asr: OnceCell<RefCell<SenseVoiceAsr>>,
    embedding: OnceCell<RefCell<OnnxEmbeddingModel>>,
    pii: OnceCell<RefCell<GlinerPiiDetector>>,
    speaker: OnceCell<RefCell<SpeakerEmbeddingExtractor>>,
}

impl Default for OnnxRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl OnnxRuntime {
    pub fn new() -> Self {
        Self {
            model_manager: ModelManager::from_default_dir(),
            vad: OnceCell::new(),
            asr: OnceCell::new(),
            embedding: OnceCell::new(),
            pii: OnceCell::new(),
            speaker: OnceCell::new(),
        }
    }

    /// Create a runtime for standalone diagnostics that never contacts Cradle Server.
    pub fn new_local_only() -> Self {
        Self {
            model_manager: ModelManager::from_default_dir_local_only(),
            vad: OnceCell::new(),
            asr: OnceCell::new(),
            embedding: OnceCell::new(),
            pii: OnceCell::new(),
            speaker: OnceCell::new(),
        }
    }

    /// Get or initialize the Silero VAD model.
    pub fn vad(&self) -> ChronicleResult<&RefCell<SileroVad>> {
        if let Some(v) = self.vad.get() {
            return Ok(v);
        }
        let model_path = self.model_manager.ensure_model(ModelId::SileroVad)?;
        let instance = SileroVad::new(&model_path)?;
        Ok(self.vad.get_or_init(|| RefCell::new(instance)))
    }

    /// Get or initialize the SenseVoice ASR model.
    pub fn asr(&self) -> ChronicleResult<&RefCell<SenseVoiceAsr>> {
        if let Some(v) = self.asr.get() {
            return Ok(v);
        }
        let model_path = self.model_manager.ensure_model(ModelId::SenseVoiceAsr)?;
        let tokens_path = companion_file(&model_path, SENSEVOICE_TOKENS)?;
        let instance = SenseVoiceAsr::new(&model_path, &tokens_path)?;
        Ok(self.asr.get_or_init(|| RefCell::new(instance)))
    }

    /// Get or initialize the embedding model.
    pub fn embedding(&self) -> ChronicleResult<&RefCell<OnnxEmbeddingModel>> {
        if let Some(v) = self.embedding.get() {
            return Ok(v);
        }
        let model_path = self.model_manager.ensure_model(ModelId::EmbeddingModel)?;
        let tokenizer_path = companion_file(&model_path, EMBEDDING_TOKENIZER)?;
        let instance = OnnxEmbeddingModel::new(&model_path, &tokenizer_path)?;
        Ok(self.embedding.get_or_init(|| RefCell::new(instance)))
    }

    /// Get or initialize the PII detector.
    pub fn pii(&self) -> ChronicleResult<&RefCell<GlinerPiiDetector>> {
        if let Some(v) = self.pii.get() {
            return Ok(v);
        }
        let model_path = self.model_manager.ensure_model(ModelId::GlinerPii)?;
        let tokenizer_path = companion_file(&model_path, GLINER_TOKENIZER)?;
        let instance = GlinerPiiDetector::new(&model_path, &tokenizer_path)?;
        Ok(self.pii.get_or_init(|| RefCell::new(instance)))
    }

    /// Get or initialize the speaker embedding extractor.
    pub fn speaker(&self) -> ChronicleResult<&RefCell<SpeakerEmbeddingExtractor>> {
        if let Some(v) = self.speaker.get() {
            return Ok(v);
        }
        let model_path = self
            .model_manager
            .ensure_model(ModelId::SpeakerEmbeddingExtractor)?;
        let instance = SpeakerEmbeddingExtractor::new(&model_path)?;
        Ok(self.speaker.get_or_init(|| RefCell::new(instance)))
    }

    /// Check which models are available (downloaded) on disk.
    pub fn available_models(&self) -> Vec<ModelId> {
        self.model_manager
            .list_cached()
            .into_iter()
            .map(|(id, _)| id)
            .collect()
    }

    /// Download all models eagerly (but don't load into sessions yet).
    pub fn ensure_all_models(&self) -> ChronicleResult<()> {
        self.model_manager.ensure_model(ModelId::SileroVad)?;
        self.model_manager.ensure_model(ModelId::SenseVoiceAsr)?;
        self.model_manager.ensure_model(ModelId::EmbeddingModel)?;
        self.model_manager.ensure_model(ModelId::GlinerPii)?;
        self.model_manager
            .ensure_model(ModelId::SpeakerEmbeddingExtractor)?;
        Ok(())
    }
}

/// Get the path for a companion file (tokens, tokenizer) that the server installs alongside the model.
/// Returns error if the file doesn't exist (server should have installed it with the model).
fn companion_file(model_path: &Path, relative_path: &str) -> ChronicleResult<PathBuf> {
    // The models root is the ancestor directory containing all model categories.
    // model_path is like: ~/.cradle/chronicle/models/audio-asr/sensevoice/model.int8.onnx
    // We need to find the models root (the dir that contains category dirs).
    // Walk up from model_path until we find the models root that, joined with relative_path, exists.
    let mut dir = model_path.parent();
    while let Some(d) = dir {
        let candidate = d.join(relative_path);
        if candidate.exists() {
            return Ok(candidate);
        }
        dir = d.parent();
    }

    // Fallback: sibling to model file
    let fallback = model_path.parent().unwrap_or(Path::new(".")).join(
        Path::new(relative_path)
            .file_name()
            .unwrap_or(relative_path.as_ref()),
    );

    if fallback.exists() {
        return Ok(fallback);
    }

    Err(ChronicleError::Process(format!(
        "companion file '{}' not found (expected server to install it with the model)",
        relative_path
    )))
}
