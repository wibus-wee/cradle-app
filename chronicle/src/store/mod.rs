//! Local evidence outbox for Chronicle runtime events.
//!
//! Rust Chronicle writes artifacts first, then records evidence events here so
//! Cradle Server can own memory/activity/knowledge semantics without risking
//! local evidence loss when Server is temporarily unavailable.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{ChronicleError, ChronicleResult};
use crate::integrations::cradle_server::cradle_base_url;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone)]
pub struct ChronicleOutbox {
    root: PathBuf,
}

impl ChronicleOutbox {
    pub fn new(storage_root: impl Into<PathBuf>) -> Self {
        Self {
            root: storage_root.into().join("outbox"),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn events_path(&self) -> PathBuf {
        self.root.join("events.ndjson")
    }

    pub fn append_event(&self, event: &ChronicleOutboxEvent) -> ChronicleResult<()> {
        fs::create_dir_all(&self.root).map_err(|error| ChronicleError::io_at(&self.root, error))?;
        let path = self.events_path();
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| ChronicleError::io_at(&path, error))?;
        serde_json::to_writer(&mut file, event).map_err(|error| {
            ChronicleError::Process(format!("serialize outbox event {}: {error}", event.id))
        })?;
        file.write_all(b"\n")
            .map_err(|error| ChronicleError::io_at(&path, error))?;
        Ok(())
    }

    pub fn append_and_try_deliver(
        &self,
        event: &ChronicleOutboxEvent,
    ) -> ChronicleResult<ChronicleDeliveryStatus> {
        self.append_event(event)?;
        Ok(self.try_deliver(event))
    }

    pub fn try_deliver(&self, event: &ChronicleOutboxEvent) -> ChronicleDeliveryStatus {
        let Some(route) = delivery_route(event) else {
            return ChronicleDeliveryStatus::Skipped;
        };
        let url = format!("{}{}", cradle_base_url().trim_end_matches('/'), route);
        let body = event.payload.to_string();
        match ureq::post(&url)
            .header("Content-Type", "application/json; charset=utf-8")
            .config()
            .timeout_global(Some(REQUEST_TIMEOUT))
            .build()
            .send(body.as_bytes())
        {
            Ok(response) if response.status().as_u16() < 400 => ChronicleDeliveryStatus::Delivered,
            Ok(response) => ChronicleDeliveryStatus::Failed(format!(
                "server returned status {} for {}",
                response.status(),
                event.kind
            )),
            Err(error) => ChronicleDeliveryStatus::Failed(error.to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChronicleDeliveryStatus {
    Delivered,
    Skipped,
    Failed(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChronicleOutboxEvent {
    pub id: String,
    pub kind: String,
    pub created_at: String,
    pub payload: serde_json::Value,
}

fn delivery_route(event: &ChronicleOutboxEvent) -> Option<String> {
    match event.kind.as_str() {
        "snapshot" => Some("/chronicle/snapshots".to_string()),
        "accessibility-event" => Some("/chronicle/accessibility-events".to_string()),
        "audio-raw-segment" => Some("/chronicle/audio-raw-segments".to_string()),
        "audio-transcript" => Some("/chronicle/audio-transcripts".to_string()),
        "speaker-profile" => Some("/chronicle/speaker-profiles".to_string()),
        "audio-raw-processing-result" => {
            let source_id = event.payload.get("sourceId")?.as_str()?;
            Some(format!(
                "/chronicle/audio-raw-segments/{}/processing-result",
                encode_path_segment(source_id)
            ))
        }
        _ => None,
    }
}

fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::store::{ChronicleDeliveryStatus, ChronicleOutbox, ChronicleOutboxEvent};

    #[test]
    fn appends_evidence_events_to_outbox() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-outbox-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let outbox = ChronicleOutbox::new(&root);

        outbox
            .append_event(&ChronicleOutboxEvent {
                id: "event-1".to_string(),
                kind: "snapshot".to_string(),
                created_at: "2026-06-07T00-00-00Z".to_string(),
                payload: serde_json::json!({ "frames": 2 }),
            })
            .expect("event should append");

        let events = fs::read_to_string(outbox.events_path()).expect("events should read");
        assert_eq!(events.lines().count(), 1);
        assert!(events.contains("\"kind\":\"snapshot\""));
        assert!(outbox.events_path().ends_with("outbox/events.ndjson"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn skips_delivery_for_diagnostic_events() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-outbox-skip-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let outbox = ChronicleOutbox::new(&root);

        let status = outbox
            .append_and_try_deliver(&ChronicleOutboxEvent {
                id: "smoke".to_string(),
                kind: "smoke-capture".to_string(),
                created_at: "2026-06-07T00-00-00Z".to_string(),
                payload: serde_json::json!({ "persisted": 2 }),
            })
            .expect("event should append");

        assert_eq!(status, ChronicleDeliveryStatus::Skipped);
        assert!(outbox.events_path().exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn encodes_processing_result_source_id_in_route() {
        let event = ChronicleOutboxEvent {
            id: "processing".to_string(),
            kind: "audio-raw-processing-result".to_string(),
            created_at: "2026-06-07T00-00-00Z".to_string(),
            payload: serde_json::json!({ "sourceId": "audio:microphone:/tmp/a b.json" }),
        };

        assert_eq!(
            super::delivery_route(&event).as_deref(),
            Some(
                "/chronicle/audio-raw-segments/audio%3Amicrophone%3A%2Ftmp%2Fa%20b.json/processing-result"
            )
        );
    }
}
