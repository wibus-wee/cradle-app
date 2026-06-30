//! Recorder orchestration for Cradle Chronicle.

use std::collections::HashMap;

use crate::error::ChronicleResult;
use crate::ocr::TextExtractor;
use crate::recorder::artifacts::{ArtifactStore, PersistedFrame};
use crate::recorder::fingerprint::FrameFingerprint;
use crate::screen::CaptureSource;
use crate::screen::privacy_filter::PrivacyFilter;

pub struct RecorderManager<S, O> {
    source: S,
    extractor: O,
    privacy_filter: PrivacyFilter,
    artifact_store: ArtifactStore,
    state: RecorderState,
}

impl<S, O> RecorderManager<S, O>
where
    S: CaptureSource,
    O: TextExtractor,
{
    pub fn new(source: S, extractor: O, artifact_store: ArtifactStore) -> Self {
        Self::with_privacy_filter(source, extractor, artifact_store, PrivacyFilter::default())
    }

    pub fn with_privacy_filter(
        source: S,
        extractor: O,
        artifact_store: ArtifactStore,
        privacy_filter: PrivacyFilter,
    ) -> Self {
        Self::with_privacy_filter_and_state(
            source,
            extractor,
            artifact_store,
            privacy_filter,
            RecorderState::default(),
        )
    }

    pub fn with_privacy_filter_and_state(
        source: S,
        extractor: O,
        artifact_store: ArtifactStore,
        privacy_filter: PrivacyFilter,
        state: RecorderState,
    ) -> Self {
        Self {
            source,
            extractor,
            privacy_filter,
            artifact_store,
            state,
        }
    }

    pub fn run_until_exhausted(&mut self) -> ChronicleResult<RecorderReport> {
        let mut report = RecorderReport::default();

        while let Some(frame) = self.source.next_frame()? {
            report.observed_frames += 1;

            if self.privacy_filter.should_exclude_frame(&frame) {
                report.privacy_filtered_frames += 1;
                continue;
            }

            let ocr = self.extractor.extract_text(&frame)?;
            let fingerprint = FrameFingerprint::from_parts(&frame.bytes, &ocr.normalized_text);
            report.latest_fingerprint = Some(fingerprint);
            if self
                .state
                .previous_fingerprints
                .get(&frame.display_id)
                .is_some_and(|previous| fingerprint.is_duplicate_of(*previous))
            {
                report.duplicate_frames += 1;
                continue;
            }

            self.state
                .previous_fingerprints
                .insert(frame.display_id, fingerprint);
            let persisted = self.artifact_store.persist_frame(&frame, &ocr)?;
            report.persisted_frames.push(persisted);
        }

        Ok(report)
    }

    pub fn into_state(self) -> RecorderState {
        self.state
    }
}

#[derive(Debug, Default, Clone)]
pub struct RecorderState {
    previous_fingerprints: HashMap<u32, FrameFingerprint>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RecorderReport {
    pub observed_frames: usize,
    pub privacy_filtered_frames: usize,
    pub duplicate_frames: usize,
    pub persisted_frames: Vec<PersistedFrame>,
    pub latest_fingerprint: Option<FrameFingerprint>,
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::ocr::ObservedTextExtractor;
    use crate::recorder::artifacts::ArtifactStore;
    use crate::screen::privacy_filter::{PrivacyFilter, PrivacyFilterRules};
    use crate::screen::synthetic::SyntheticCaptureSource;
    use crate::screen::{
        AccessibilityCapture, AccessibilityCaptureStatus, BrowserWindowObservation, CapturedFrame,
    };
    use crate::time::Timestamp;

    use super::RecorderManager;

    #[test]
    fn filters_duplicates_and_private_frames() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-manager-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let frames = vec![
            frame(
                1,
                "same",
                BrowserWindowObservation::new(1, "Cradle", "app.cradle"),
            ),
            frame(
                2,
                "same",
                BrowserWindowObservation::new(1, "Cradle", "app.cradle"),
            ),
            frame(
                3,
                "private",
                BrowserWindowObservation::new(2, "Search Incognito", "com.google.Chrome"),
            ),
            frame(
                4,
                "different",
                BrowserWindowObservation::new(1, "Cradle", "app.cradle"),
            ),
        ];
        let source = SyntheticCaptureSource::from_frames(frames);
        let store = ArtifactStore::new(&root, Timestamp::from_seconds(1_779_125_791));
        let mut manager = RecorderManager::new(source, ObservedTextExtractor, store);

        let report = manager.run_until_exhausted().expect("run should succeed");

        assert_eq!(report.observed_frames, 4);
        assert_eq!(report.duplicate_frames, 1);
        assert_eq!(report.privacy_filtered_frames, 1);
        assert_eq!(report.persisted_frames.len(), 2);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn deduplicates_three_displays_independently() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-manager-display-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let frames = vec![
            display_frame(10, 1, "same"),
            display_frame(20, 1, "same"),
            display_frame(30, 1, "same"),
            display_frame(10, 2, "same"),
            display_frame(20, 2, "same"),
            display_frame(30, 2, "same"),
        ];
        let source = SyntheticCaptureSource::from_frames(frames);
        let store = ArtifactStore::new(&root, Timestamp::from_seconds(1_779_125_791));
        let mut manager = RecorderManager::new(source, ObservedTextExtractor, store);

        let report = manager.run_until_exhausted().expect("run should succeed");

        assert_eq!(report.observed_frames, 6);
        assert_eq!(report.duplicate_frames, 3);
        assert_eq!(report.persisted_frames.len(), 3);
        assert!(
            report
                .persisted_frames
                .iter()
                .any(|frame| frame.display_id == 10)
        );
        assert!(
            report
                .persisted_frames
                .iter()
                .any(|frame| frame.display_id == 20)
        );
        assert!(
            report
                .persisted_frames
                .iter()
                .any(|frame| frame.display_id == 30)
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn carries_dedup_state_between_manager_instances() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-manager-state-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let first_source = SyntheticCaptureSource::from_frames(vec![frame(
            1,
            "same",
            BrowserWindowObservation::new(1, "Cradle", "app.cradle"),
        )]);
        let first_store = ArtifactStore::new(&root, Timestamp::from_seconds(1_779_125_791));
        let mut first_manager =
            RecorderManager::new(first_source, ObservedTextExtractor, first_store);
        let first_report = first_manager
            .run_until_exhausted()
            .expect("first run should succeed");
        let state = first_manager.into_state();

        assert_eq!(first_report.persisted_frames.len(), 1);

        let second_source = SyntheticCaptureSource::from_frames(vec![frame(
            2,
            "same",
            BrowserWindowObservation::new(1, "Cradle", "app.cradle"),
        )]);
        let second_store = ArtifactStore::new(&root, Timestamp::from_seconds(1_779_125_792));
        let mut second_manager = RecorderManager::with_privacy_filter_and_state(
            second_source,
            ObservedTextExtractor,
            second_store,
            PrivacyFilter::default(),
            state,
        );
        let second_report = second_manager
            .run_until_exhausted()
            .expect("second run should succeed");

        assert_eq!(second_report.observed_frames, 1);
        assert_eq!(second_report.duplicate_frames, 1);
        assert!(second_report.persisted_frames.is_empty());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn applies_configured_privacy_rules_to_capture_flow() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-manager-privacy-rules-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let frames = vec![
            frame(
                1,
                "terminal",
                BrowserWindowObservation::new(1, "Logs", "com.apple.Terminal"),
            ),
            frame(
                2,
                "bank",
                BrowserWindowObservation::new(1, "Bank Dashboard", "com.apple.Safari"),
            ),
            frame(
                3,
                "admin",
                BrowserWindowObservation::new(1, "Admin", "com.google.Chrome")
                    .with_url("https://admin.example.com/settings"),
            ),
            frame(
                4,
                "cradle",
                BrowserWindowObservation::new(1, "Cradle", "app.cradle"),
            ),
        ];
        let source = SyntheticCaptureSource::from_frames(frames);
        let store = ArtifactStore::new(&root, Timestamp::from_seconds(1_779_125_791));
        let filter = PrivacyFilter::new(PrivacyFilterRules {
            app_bundle_ids: vec!["com.apple.Terminal".to_string()],
            title_patterns: vec!["bank dashboard".to_string()],
            url_patterns: vec!["admin.example.com".to_string()],
        });
        let mut manager =
            RecorderManager::with_privacy_filter(source, ObservedTextExtractor, store, filter);

        let report = manager.run_until_exhausted().expect("run should succeed");

        assert_eq!(report.observed_frames, 4);
        assert_eq!(report.privacy_filtered_frames, 3);
        assert_eq!(report.persisted_frames.len(), 1);

        let _ = fs::remove_dir_all(&root);
    }

    fn frame(index: u64, text: &str, window: BrowserWindowObservation) -> CapturedFrame {
        frame_for_display(1, index, text, window)
    }

    fn display_frame(display_id: u32, index: u64, text: &str) -> CapturedFrame {
        frame_for_display(
            display_id,
            index,
            text,
            BrowserWindowObservation::new(display_id, "Cradle", "app.cradle"),
        )
    }

    fn frame_for_display(
        display_id: u32,
        index: u64,
        text: &str,
        window: BrowserWindowObservation,
    ) -> CapturedFrame {
        let windows = vec![window];
        CapturedFrame {
            display_id,
            frame_index: index,
            captured_at: Timestamp::from_seconds(1_779_125_791 + index),
            bytes: text.as_bytes().to_vec(),
            frame_extension: "jpg".to_string(),
            observed_text: text.to_string(),
            accessibility: AccessibilityCapture::from_windows(
                &windows,
                AccessibilityCaptureStatus::Ready,
            ),
            windows,
        }
    }
}
