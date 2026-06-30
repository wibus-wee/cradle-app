//! Synthetic capture source for tests and smoke validation.

use std::collections::VecDeque;

use crate::error::ChronicleResult;
use crate::screen::{
    AccessibilityCapture, AccessibilityCaptureStatus, BrowserWindowObservation, CaptureSource,
    CapturedFrame,
};
use crate::time::{Timestamp, timestamp_after_seconds};

pub struct SyntheticCaptureSource {
    frames: VecDeque<CapturedFrame>,
}

impl SyntheticCaptureSource {
    pub fn cradle_smoke(display_id: u32, capture_limit: usize) -> Self {
        Self::cradle_smoke_from(
            display_id,
            capture_limit,
            Timestamp::from_seconds(1_779_125_791),
        )
    }

    pub fn cradle_smoke_from(
        display_id: u32,
        capture_limit: usize,
        start_timestamp: Timestamp,
    ) -> Self {
        let seeds = [
            "Cradle Chronicle smoke frame: user is reviewing a Rust passive memory pipeline.",
            "Cradle Chronicle smoke frame: artifacts, OCR text, and evidence outbox are being validated.",
            "Cradle Chronicle smoke frame: future capture providers can reuse the same storage contract.",
        ];
        let frames = (0..capture_limit)
            .map(|index| {
                let text = seeds[index % seeds.len()].to_string();
                let windows = vec![BrowserWindowObservation::new(
                    100 + index as u32,
                    "Cradle Chronicle Smoke",
                    "app.cradle.desktop",
                )];
                CapturedFrame {
                    display_id,
                    frame_index: index as u64 + 1,
                    captured_at: timestamp_after_seconds(
                        start_timestamp.seconds_since_epoch(),
                        index as u64,
                    ),
                    bytes: text.as_bytes().to_vec(),
                    frame_extension: "jpg".to_string(),
                    observed_text: text,
                    accessibility: AccessibilityCapture::from_windows(
                        &windows,
                        AccessibilityCaptureStatus::Ready,
                    ),
                    windows,
                }
            })
            .collect();

        Self { frames }
    }

    pub fn from_frames(frames: Vec<CapturedFrame>) -> Self {
        Self {
            frames: frames.into(),
        }
    }
}

impl CaptureSource for SyntheticCaptureSource {
    fn next_frame(&mut self) -> ChronicleResult<Option<CapturedFrame>> {
        Ok(self.frames.pop_front())
    }
}

#[cfg(test)]
mod tests {
    use crate::screen::CaptureSource;

    use super::SyntheticCaptureSource;

    #[test]
    fn emits_requested_number_of_frames() {
        let mut source = SyntheticCaptureSource::cradle_smoke(7, 2);
        let first = source
            .next_frame()
            .expect("source should read")
            .expect("frame should exist");
        let second = source
            .next_frame()
            .expect("source should read")
            .expect("frame should exist");
        let third = source.next_frame().expect("source should read");

        assert_eq!(first.display_id, 7);
        assert_eq!(second.frame_index, 2);
        assert!(third.is_none());
    }
}
