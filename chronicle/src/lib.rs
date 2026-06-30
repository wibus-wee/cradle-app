//! Cradle Chronicle local evidence runtime.
//!
//! Rust owns capture, local model diagnostics, artifacts, and evidence outbox.
//! Cradle Server owns memory, activity, knowledge, search, and product state.

pub mod audio;
pub mod config;
pub mod daemon;
pub mod error;
pub mod integrations;
pub(crate) mod json;
pub mod meeting;
pub mod models;
pub mod ocr;
pub mod onnx;
pub mod recorder;
pub mod screen;
pub mod store;
pub mod time;

pub use config::ChronicleConfig;
pub use error::{ChronicleError, ChronicleResult};
pub use recorder::manager::{RecorderManager, RecorderReport};
