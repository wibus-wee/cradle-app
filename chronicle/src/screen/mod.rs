//! Capture source abstractions for Cradle Chronicle.

pub mod inbox;
pub mod macos;
pub mod privacy_filter;
pub mod synthetic;

use crate::error::ChronicleResult;
use crate::time::Timestamp;

pub trait CaptureSource {
    fn next_frame(&mut self) -> ChronicleResult<Option<CapturedFrame>>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedFrame {
    pub display_id: u32,
    pub frame_index: u64,
    pub captured_at: Timestamp,
    pub bytes: Vec<u8>,
    pub frame_extension: String,
    pub observed_text: String,
    pub windows: Vec<BrowserWindowObservation>,
    pub accessibility: AccessibilityCapture,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccessibilityCapture {
    pub status: AccessibilityCaptureStatus,
    pub provider: String,
    pub text: String,
    pub elements: Vec<AccessibilityElementObservation>,
}

impl AccessibilityCapture {
    pub fn from_elements(
        provider: impl Into<String>,
        status: AccessibilityCaptureStatus,
        elements: Vec<AccessibilityElementObservation>,
    ) -> Self {
        let text = elements
            .iter()
            .flat_map(|element| {
                [
                    element.label.as_str(),
                    element.value.as_deref().unwrap_or_default(),
                ]
            })
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        Self {
            status,
            provider: provider.into(),
            text,
            elements,
        }
    }

    pub fn from_windows(
        windows: &[BrowserWindowObservation],
        status: AccessibilityCaptureStatus,
    ) -> Self {
        let elements = windows
            .iter()
            .enumerate()
            .map(|(index, window)| AccessibilityElementObservation {
                role: "window".to_string(),
                label: window.name.clone(),
                value: window.url.clone(),
                app_bundle_identifier: window.app_bundle_identifier.clone(),
                window_id: Some(window.id),
                depth: 0,
                path: format!("window:{index}"),
            })
            .collect::<Vec<_>>();
        Self::from_elements("macos-accessibility-window-inventory", status, elements)
    }

    pub fn unavailable(provider: impl Into<String>) -> Self {
        Self {
            status: AccessibilityCaptureStatus::Unavailable,
            provider: provider.into(),
            text: String::new(),
            elements: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessibilityCaptureStatus {
    Ready,
    PermissionDenied,
    Unavailable,
    Error,
}

impl AccessibilityCaptureStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::PermissionDenied => "permission-denied",
            Self::Unavailable => "unavailable",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccessibilityElementObservation {
    pub role: String,
    pub label: String,
    pub value: Option<String>,
    pub app_bundle_identifier: String,
    pub window_id: Option<u32>,
    pub depth: usize,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserWindowObservation {
    pub id: u32,
    pub name: String,
    pub app_bundle_identifier: String,
    pub url: Option<String>,
    pub is_private: bool,
}

impl BrowserWindowObservation {
    pub fn new(id: u32, name: impl Into<String>, app_bundle_identifier: impl Into<String>) -> Self {
        Self {
            id,
            name: name.into(),
            app_bundle_identifier: app_bundle_identifier.into(),
            url: None,
            is_private: false,
        }
    }

    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    pub fn with_private_flag(mut self) -> Self {
        self.is_private = true;
        self
    }
}
