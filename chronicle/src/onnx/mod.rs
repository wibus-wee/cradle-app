//! ONNX Runtime inference providers for Chronicle local models.
//!
//! All models run locally through ONNX Runtime (`ort` crate with `load-dynamic` feature).
//! Models are downloaded on demand via [`crate::models::ModelManager`].

pub mod asr;
pub mod embedding;
pub mod pii;
pub mod runtime;
pub mod speaker;
pub mod vad;

pub use runtime::OnnxRuntime;

use std::path::{Path, PathBuf};
use std::sync::Once;

use ort::session::{Session, builder::GraphOptimizationLevel};

use crate::error::{ChronicleError, ChronicleResult};

static ORT_INIT: Once = Once::new();

/// Initialize ONNX Runtime environment (idempotent).
pub fn init_runtime() {
    ORT_INIT.call_once(|| {
        if let Some(dylib_path) = find_onnxruntime_dylib()
            && ort::init_from(dylib_path)
                .map(|builder| builder.commit())
                .is_ok()
        {
            return;
        }
        ort::init().commit();
    });
}

/// Load an ONNX model from disk into a session.
pub fn load_session(model_path: &Path) -> ChronicleResult<Session> {
    init_runtime();

    let mut builder = Session::builder()
        .map_err(|e| ChronicleError::Process(format!("ONNX session builder failed: {e}")))?;

    builder = builder
        .with_optimization_level(onnx_graph_optimization_level())
        .map_err(|e| ChronicleError::Process(format!("ONNX optimization level failed: {e}")))?;

    builder = builder
        .with_intra_threads(2)
        .map_err(|e| ChronicleError::Process(format!("ONNX intra threads failed: {e}")))?;

    builder
        .commit_from_file(model_path)
        .map_err(|e| ChronicleError::Process(format!("ONNX session load failed: {e}")))
}

fn onnx_graph_optimization_level() -> GraphOptimizationLevel {
    match std::env::var("CRADLE_ONNX_GRAPH_OPTIMIZATION")
        .unwrap_or_else(|_| "level1".to_string())
        .to_ascii_lowercase()
        .as_str()
    {
        "disable" | "disabled" | "none" => GraphOptimizationLevel::Disable,
        "level2" | "extended" => GraphOptimizationLevel::Level2,
        "level3" | "layout" => GraphOptimizationLevel::Level3,
        "all" => GraphOptimizationLevel::All,
        _ => GraphOptimizationLevel::Level1,
    }
}

fn find_onnxruntime_dylib() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("ORT_DYLIB_PATH").map(PathBuf::from)
        && path.is_file()
    {
        return Some(path);
    }

    let mut roots = Vec::new();
    if let Some(models_root) = std::env::var_os("CRADLE_MODELS_DIR").map(PathBuf::from) {
        roots.push(models_root.join("onnxruntime"));
        roots.push(models_root);
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".cradle").join("chronicle").join("models"));
        roots.push(home.join(".cache").join("uv").join("archive-v0"));
    }

    roots
        .into_iter()
        .filter_map(|root| find_onnxruntime_dylib_in_tree(&root, 6))
        .next()
}

fn find_onnxruntime_dylib_in_tree(root: &Path, depth: usize) -> Option<PathBuf> {
    if depth == 0 || !root.exists() {
        return None;
    }

    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && is_onnxruntime_dylib(&path) {
            return Some(path);
        }
        if path.is_dir()
            && let Some(found) = find_onnxruntime_dylib_in_tree(&path, depth - 1)
        {
            return Some(found);
        }
    }
    None
}

fn is_onnxruntime_dylib(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    (name == "libonnxruntime.dylib"
        || (name.starts_with("libonnxruntime.") && name.ends_with(".dylib")))
        || name == "libonnxruntime.so"
        || (name.starts_with("libonnxruntime.so.") && name.len() > "libonnxruntime.so.".len())
}

/// Return a compact description of an ONNX model's input and output contract.
pub fn inspect_model(model_path: &Path) -> ChronicleResult<String> {
    let session = load_session(model_path)?;
    let mut lines = vec![
        format!("model={}", model_path.display()),
        "inputs:".to_string(),
    ];
    for input in session.inputs() {
        lines.push(format!("  {}: {}", input.name(), input.dtype()));
    }
    lines.push("outputs:".to_string());
    for output in session.outputs() {
        lines.push(format!("  {}: {}", output.name(), output.dtype()));
    }
    Ok(lines.join("\n"))
}
