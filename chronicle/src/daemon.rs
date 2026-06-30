//! Daemon mode for Cradle Chronicle.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use crate::audio::{
    AudioArtifactMetadata, LocalTranscriptionPipeline, RmsActivityGate, TranscriptionResult,
    TranscriptionRuntime, capture_microphone_samples, capture_mixed_audio_samples,
    capture_system_audio_samples, write_audio_segment_artifact,
};
use crate::config::{AudioCaptureSource, CaptureProvider, ChronicleConfig};
use crate::error::{ChronicleError, ChronicleResult};
use crate::meeting::detect_meeting;
use crate::ocr::ObservedTextExtractor;
use crate::recorder::artifacts::{ArtifactStore, PersistedFrame};
use crate::recorder::fingerprint::FrameFingerprint;
use crate::recorder::manager::RecorderState;
use crate::recorder::sampler::AdaptiveSampler;
use crate::screen::BrowserWindowObservation;
use crate::screen::inbox::InboxCaptureSource;
use crate::screen::privacy_filter::{PrivacyFilter, PrivacyFilterRules};
use crate::store::{ChronicleDeliveryStatus, ChronicleOutbox, ChronicleOutboxEvent};
use crate::time::Timestamp;

#[cfg(target_os = "macos")]
use crate::screen::macos::{
    AxObserverRuntime, MacosCaptureSource, read_ax_observer_accessibility_capture,
};

use crate::RecorderManager;

static SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Run Chronicle in daemon mode.
pub fn run(config: ChronicleConfig) -> ChronicleResult<String> {
    fs::create_dir_all(&config.storage_root)
        .map_err(|e| ChronicleError::io_at(&config.storage_root, e))?;
    if config.provider == CaptureProvider::Inbox {
        fs::create_dir_all(&config.inbox_root)
            .map_err(|e| ChronicleError::io_at(&config.inbox_root, e))?;
    }

    // Single instance lock
    let lock = InstanceLock::acquire(&config.storage_root)?;

    // Signal handling
    install_signal_handlers();

    // Write PID file
    write_pid_file(&config.storage_root)?;

    eprintln!("screen recording starting");
    eprintln!(
        "cradle chronicle daemon started: provider={:?} storage_root={} inbox_root={}",
        config.provider,
        config.storage_root.display(),
        config.inbox_root.display()
    );

    if config.run_once {
        let outbox = ChronicleOutbox::new(&config.storage_root);
        let mut recorder_state = RecorderState::default();
        let report = capture_once(&config, 1, &mut recorder_state)?;
        process_transcripts(&config.inbox_root, &outbox);
        let onnx_runtime = crate::onnx::OnnxRuntime::new_local_only();
        let local_transcription = LocalTranscriptionPipeline::new(&onnx_runtime);
        if config.audio_capture {
            process_audio_segment(&config, &outbox, &local_transcription);
        }
        record_snapshots(&outbox, &report.persisted_frames);
        drop(lock);
        cleanup_pid_file(&config.storage_root);
        return Ok(format!(
            "cradle chronicle daemon processed once: observed={} persisted={} duplicates={} privacy_filtered={}",
            report.observed_frames,
            report.persisted_frames.len(),
            report.duplicate_frames,
            report.privacy_filtered_frames
        ));
    }

    let result = daemon_loop(&config);

    // Cleanup
    drop(lock);
    cleanup_pid_file(&config.storage_root);
    eprintln!("screen recording stopped by user");

    result
}

fn daemon_loop(config: &ChronicleConfig) -> ChronicleResult<String> {
    let outbox = ChronicleOutbox::new(&config.storage_root);
    let mut sampler = AdaptiveSampler::new(
        config.poll_interval_ms,
        config.min_interval_ms,
        config.max_interval_ms,
    );
    let mut recorder_state = RecorderState::default();
    let mut frame_index: u64 = 1;
    let mut last_audio_segment_time: Option<Instant> = None;
    let mut is_idle = false;
    #[cfg(target_os = "macos")]
    let mut ax_observer = start_ax_observer(config);

    let mut last_cleanup_check = Instant::now();
    let cleanup_interval = Duration::from_secs(60 * 60);

    // Meeting detection state
    let mut is_in_meeting = false;

    // ONNX Runtime — local model inference (VAD, ASR, speaker embedding).
    // Models are loaded lazily from the local model root; daemon capture never
    // blocks on Server-side model installation.
    let onnx_runtime = crate::onnx::OnnxRuntime::new_local_only();
    eprintln!("cradle chronicle onnx runtime initialized (local models load on demand)");

    // Audio transcription pipeline: local ONNX (Silero VAD + SenseVoice ASR)
    let local_transcription = crate::audio::asr::LocalTranscriptionPipeline::new(&onnx_runtime);
    eprintln!("cradle chronicle audio transcription pipeline ready (local ONNX)");

    while !SHUTDOWN_REQUESTED.load(Ordering::Relaxed) {
        process_transcripts(&config.inbox_root, &outbox);
        process_audio_segment_if_due(
            config,
            &outbox,
            &local_transcription,
            &mut last_audio_segment_time,
        );
        #[cfg(target_os = "macos")]
        refresh_ax_observer(config, &mut ax_observer);
        #[cfg(target_os = "macos")]
        process_ax_observer_events(
            config,
            &outbox,
            &ax_observer,
            &mut frame_index,
            &mut recorder_state,
        );

        // Check system idle
        let idle_seconds = system_idle_seconds();
        if idle_seconds >= config.idle_timeout_seconds && !is_idle {
            is_idle = true;
            eprintln!("pausing screen recording due to system idle time");
        }
        if is_idle {
            if idle_seconds < config.idle_timeout_seconds {
                is_idle = false;
                sampler.reset(config.poll_interval_ms);
                eprintln!("resuming screen recording after system idle time reset");
            } else {
                thread::sleep(Duration::from_secs(2));
                continue;
            }
        }

        // Capture
        match capture_once(config, frame_index, &mut recorder_state) {
            Ok(report) => {
                frame_index += 1;
                let latest_fingerprint = report.latest_fingerprint;
                if !report.persisted_frames.is_empty() {
                    record_snapshots(&outbox, &report.persisted_frames);

                    // Meeting detection from the latest captured frame
                    if let Some(latest_frame) = report.persisted_frames.last() {
                        check_meeting_state(latest_frame, &mut is_in_meeting);
                    }

                    // Feed adaptive sampler with the actual latest frame fingerprint.
                    if let Some(fingerprint) = latest_fingerprint {
                        sampler.observe(fingerprint);
                    }

                    eprintln!(
                        "cradle chronicle daemon processed batch: observed={} persisted={}",
                        report.observed_frames,
                        report.persisted_frames.len()
                    );
                } else {
                    if let Some(fingerprint) = latest_fingerprint {
                        sampler.observe(fingerprint);
                    } else {
                        // No visible content reached OCR; signal stable inactivity.
                        let fp = FrameFingerprint::from_parts(b"no-frame", "no-frame");
                        sampler.observe(fp);
                    }
                }
            }
            Err(e) => {
                eprintln!("cradle chronicle capture error: {e}");
            }
        }

        if last_cleanup_check.elapsed() >= cleanup_interval {
            if let Ok(now) = Timestamp::now() {
                match cleanup_runtime_storage(&config.storage_root, now) {
                    Ok(report) => eprintln!(
                        "cradle chronicle cleanup removed_files={} removed_dirs={} kept_files={}",
                        report.removed_files, report.removed_dirs, report.kept_files
                    ),
                    Err(error) => eprintln!("cradle chronicle cleanup error: {error}"),
                }
            }
            last_cleanup_check = Instant::now();
        }

        let interval = Duration::from_millis(sampler.current_interval_ms());
        thread::sleep(interval);
    }

    Ok("cradle chronicle daemon stopped".to_string())
}

#[cfg(target_os = "macos")]
fn start_ax_observer(config: &ChronicleConfig) -> Option<AxObserverRuntime> {
    if config.provider != CaptureProvider::Macos || !config.ax_observer {
        return None;
    }
    match AxObserverRuntime::start_for_frontmost_app() {
        Ok(observer) => {
            eprintln!(
                "cradle chronicle AXObserver started: pid={} bundle={}",
                observer.target_pid(),
                observer.target_bundle_identifier()
            );
            Some(observer)
        }
        Err(error) => {
            eprintln!("cradle chronicle AXObserver unavailable: {error}");
            None
        }
    }
}

#[cfg(target_os = "macos")]
fn refresh_ax_observer(config: &ChronicleConfig, observer: &mut Option<AxObserverRuntime>) {
    if config.provider != CaptureProvider::Macos || !config.ax_observer {
        *observer = None;
        return;
    }
    let changed = observer
        .as_ref()
        .is_none_or(AxObserverRuntime::frontmost_target_changed);
    if !changed {
        return;
    }
    if let Some(previous) = observer.take() {
        eprintln!(
            "cradle chronicle AXObserver target changed, stopping pid={} bundle={}",
            previous.target_pid(),
            previous.target_bundle_identifier()
        );
    }
    *observer = start_ax_observer(config);
}

#[cfg(target_os = "macos")]
fn process_ax_observer_events(
    config: &ChronicleConfig,
    outbox: &ChronicleOutbox,
    observer: &Option<AxObserverRuntime>,
    frame_index: &mut u64,
    recorder_state: &mut RecorderState,
) {
    let Some(observer) = observer else {
        return;
    };
    for event in observer.drain(4) {
        let captured_at = Timestamp::now().unwrap_or_else(|_| Timestamp::from_seconds(0));
        record_accessibility_event(outbox, &event, captured_at);
        let accessibility = read_ax_observer_accessibility_capture(&event);
        match capture_macos_with_accessibility(config, *frame_index, accessibility, recorder_state)
        {
            Ok(report) => {
                *frame_index += 1;
                if !report.persisted_frames.is_empty() {
                    record_snapshots(outbox, &report.persisted_frames);
                    eprintln!(
                        "cradle chronicle AXObserver event captured: notification={} pid={} frames={} dropped_total={}",
                        event.notification,
                        event.pid,
                        report.persisted_frames.len(),
                        observer.dropped_count()
                    );
                }
            }
            Err(error) => {
                eprintln!(
                    "cradle chronicle AXObserver event capture error: notification={} pid={} error={}",
                    event.notification, event.pid, error
                );
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn record_accessibility_event(
    outbox: &ChronicleOutbox,
    event: &crate::screen::macos::AxObserverNotification,
    captured_at: Timestamp,
) {
    let source_id = accessibility_event_source_id(event, captured_at);
    record_outbox_event(
        outbox,
        ChronicleOutboxEvent {
            id: source_id.clone(),
            kind: "accessibility-event".to_string(),
            created_at: captured_at.filesystem(),
            payload: serde_json::json!({
                "sourceId": source_id,
                "provider": "macos-ax-observer",
                "appBundleId": event.app_bundle_identifier,
                "pid": event.pid,
                "notification": event.notification,
                "droppedBefore": event.dropped_before,
                "metadata": {
            "runtime": "macos-ax-observer",
            "targetBundleIdentifier": event.app_bundle_identifier,
            "targetPid": event.pid
                }
            }),
        },
    );
}

#[cfg(target_os = "macos")]
fn accessibility_event_source_id(
    event: &crate::screen::macos::AxObserverNotification,
    captured_at: Timestamp,
) -> String {
    format!(
        "accessibility-event:{}:{}:{}:{}:{}",
        sanitize_source_id_part(&event.app_bundle_identifier),
        event.pid,
        sanitize_source_id_part(&event.notification),
        captured_at.compact(),
        event.dropped_before
    )
}

#[cfg(target_os = "macos")]
fn sanitize_source_id_part(value: &str) -> String {
    let normalized = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        "unknown".to_string()
    } else {
        normalized.to_string()
    }
}

fn capture_once(
    config: &ChronicleConfig,
    frame_index: u64,
    recorder_state: &mut RecorderState,
) -> ChronicleResult<crate::RecorderReport> {
    match config.provider {
        CaptureProvider::Macos => capture_macos(config, frame_index, recorder_state),
        CaptureProvider::Inbox => capture_inbox(config, recorder_state),
    }
}

fn capture_inbox(
    config: &ChronicleConfig,
    recorder_state: &mut RecorderState,
) -> ChronicleResult<crate::RecorderReport> {
    let segment_started_at = Timestamp::now()?;
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let source = InboxCaptureSource::new(&config.inbox_root)?;
    let state = std::mem::take(recorder_state);
    let mut manager = RecorderManager::with_privacy_filter_and_state(
        source,
        ObservedTextExtractor,
        store,
        privacy_filter_from_config(config),
        state,
    );
    let report = manager.run_until_exhausted();
    *recorder_state = manager.into_state();
    report
}

#[cfg(target_os = "macos")]
fn capture_macos(
    config: &ChronicleConfig,
    frame_index: u64,
    recorder_state: &mut RecorderState,
) -> ChronicleResult<crate::RecorderReport> {
    let segment_started_at = Timestamp::now()?;
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let privacy_filter = privacy_filter_from_config(config);
    let source = match config.display_id {
        Some(display_id) => MacosCaptureSource::capture_with_privacy_filter(
            display_id,
            frame_index,
            &privacy_filter,
        )?,
        None => MacosCaptureSource::capture_all_with_privacy_filter(frame_index, &privacy_filter)?,
    };
    let state = std::mem::take(recorder_state);
    let mut manager = RecorderManager::with_privacy_filter_and_state(
        source,
        ObservedTextExtractor,
        store,
        privacy_filter,
        state,
    );
    let report = manager.run_until_exhausted();
    *recorder_state = manager.into_state();
    report
}

#[cfg(target_os = "macos")]
fn capture_macos_with_accessibility(
    config: &ChronicleConfig,
    frame_index: u64,
    accessibility: crate::screen::AccessibilityCapture,
    recorder_state: &mut RecorderState,
) -> ChronicleResult<crate::RecorderReport> {
    let segment_started_at = Timestamp::now()?;
    let store = ArtifactStore::new(&config.storage_root, segment_started_at);
    let privacy_filter = privacy_filter_from_config(config);
    let source = match config.display_id {
        Some(display_id) => MacosCaptureSource::capture_with_accessibility_and_privacy_filter(
            display_id,
            frame_index,
            accessibility,
            &privacy_filter,
        )?,
        None => MacosCaptureSource::capture_all_with_accessibility_and_privacy_filter(
            frame_index,
            accessibility,
            &privacy_filter,
        )?,
    };
    let state = std::mem::take(recorder_state);
    let mut manager = RecorderManager::with_privacy_filter_and_state(
        source,
        ObservedTextExtractor,
        store,
        privacy_filter,
        state,
    );
    let report = manager.run_until_exhausted();
    *recorder_state = manager.into_state();
    report
}

fn privacy_filter_from_config(config: &ChronicleConfig) -> PrivacyFilter {
    PrivacyFilter::new(PrivacyFilterRules {
        app_bundle_ids: config.privacy_sensitive_app_bundle_ids.clone(),
        title_patterns: config.privacy_sensitive_title_patterns.clone(),
        url_patterns: config.privacy_sensitive_url_patterns.clone(),
    })
}

#[cfg(not(target_os = "macos"))]
fn capture_macos(
    _config: &ChronicleConfig,
    _frame_index: u64,
    _recorder_state: &mut RecorderState,
) -> ChronicleResult<crate::RecorderReport> {
    Err(ChronicleError::InvalidArgument(
        "macOS capture provider is only available on macOS".to_string(),
    ))
}

fn record_snapshots(outbox: &ChronicleOutbox, persisted: &[PersistedFrame]) {
    for frame in persisted {
        record_outbox_event(
            outbox,
            ChronicleOutboxEvent {
                id: snapshot_source_id(frame),
                kind: "snapshot".to_string(),
                created_at: frame.captured_at.filesystem(),
                payload: serde_json::json!({
                    "sourceId": snapshot_source_id(frame),
                    "displayId": frame.display_id,
                    "frameIndex": frame.frame_index,
                    "capturedAt": frame.captured_at.filesystem(),
                    "segmentDir": artifact_path_text(&frame.segment_dir),
                    "framePath": artifact_path_text(&frame.frame_path),
                    "capturePath": artifact_path_text(&frame.capture_path),
                    "ocrPath": artifact_path_text(&frame.ocr_path),
                    "snapshotPath": artifact_path_text(&frame.snapshot_path),
                    "accessibilityPath": artifact_path_text(&frame.accessibility_path),
                    "ocrText": frame.normalized_text
                }),
            },
        );
    }
}

fn record_outbox_event(outbox: &ChronicleOutbox, event: ChronicleOutboxEvent) -> bool {
    match outbox.append_and_try_deliver(&event) {
        Ok(ChronicleDeliveryStatus::Delivered) => true,
        Ok(ChronicleDeliveryStatus::Skipped) => true,
        Ok(ChronicleDeliveryStatus::Failed(message)) => {
            eprintln!(
                "cradle chronicle outbox delivery deferred: kind={} id={} error={}",
                event.kind, event.id, message
            );
            true
        }
        Err(error) => {
            eprintln!("cradle chronicle outbox write failed: {error}");
            false
        }
    }
}

fn snapshot_source_id(frame: &PersistedFrame) -> String {
    format!(
        "snapshot:{}:{}:{}",
        frame.display_id,
        frame.frame_index,
        frame.captured_at.compact()
    )
}

fn check_meeting_state(frame: &PersistedFrame, is_in_meeting: &mut bool) {
    // Reconstruct window observations from accessibility elements
    let windows: Vec<BrowserWindowObservation> = frame
        .accessibility
        .elements
        .iter()
        .filter(|el| el.role == "window")
        .map(|el| {
            let mut w = BrowserWindowObservation::new(
                el.window_id.unwrap_or(0),
                &el.label,
                &el.app_bundle_identifier,
            );
            if let Some(ref url) = el.value {
                w = w.with_url(url);
            }
            w
        })
        .collect();

    let now = match Timestamp::now() {
        Ok(t) => t,
        Err(_) => return,
    };

    let detection = detect_meeting(&windows, &frame.accessibility, now);

    if detection.is_meeting && !*is_in_meeting {
        *is_in_meeting = true;
        let app = detection.meeting_app.as_deref().unwrap_or("unknown");
        let title = detection.meeting_title.as_deref().unwrap_or("unknown");
        eprintln!("cradle chronicle meeting detected: app={app} title={title}");
    } else if !detection.is_meeting && *is_in_meeting {
        *is_in_meeting = false;
        eprintln!("cradle chronicle meeting ended");
    }
}

fn process_transcripts(inbox_root: &Path, outbox: &ChronicleOutbox) {
    let transcript_root = inbox_root.join("audio-transcripts");
    if !transcript_root.exists() {
        return;
    }

    let mut manifests = Vec::new();
    let entries = match fs::read_dir(&transcript_root) {
        Ok(entries) => entries,
        Err(error) => {
            eprintln!("cradle chronicle transcript inbox error: {error}");
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("json") {
            manifests.push(path);
        }
    }
    manifests.sort();

    let mut reported = 0usize;
    for manifest_path in manifests.iter().take(3) {
        match fs::read_to_string(manifest_path) {
            Ok(body) => {
                let created_at = Timestamp::now().unwrap_or_else(|_| Timestamp::from_seconds(0));
                let payload: serde_json::Value = match serde_json::from_str(&body) {
                    Ok(value) => value,
                    Err(error) => {
                        eprintln!(
                            "cradle chronicle transcript inbox invalid JSON for {}: {error}",
                            manifest_path.display()
                        );
                        continue;
                    }
                };
                let Some(source_id) = payload.get("sourceId").and_then(serde_json::Value::as_str)
                else {
                    eprintln!(
                        "cradle chronicle transcript inbox missing sourceId: {}",
                        manifest_path.display()
                    );
                    continue;
                };
                if !payload
                    .get("segments")
                    .is_some_and(serde_json::Value::is_array)
                {
                    eprintln!(
                        "cradle chronicle transcript inbox missing segments array: {}",
                        manifest_path.display()
                    );
                    continue;
                }
                let recorded = record_outbox_event(
                    outbox,
                    ChronicleOutboxEvent {
                        id: source_id.to_string(),
                        kind: "audio-transcript".to_string(),
                        created_at: created_at.filesystem(),
                        payload,
                    },
                );
                if recorded && mark_transcript_processed(manifest_path).is_ok() {
                    reported += 1;
                }
            }
            Err(error) => {
                eprintln!(
                    "cradle chronicle transcript inbox error for {}: {error}",
                    manifest_path.display()
                );
            }
        }
    }

    if reported > 0 {
        eprintln!(
            "cradle chronicle transcript inbox processed locally: scanned={} reported={}",
            manifests.len().min(3),
            reported
        );
    }
}

fn mark_transcript_processed(manifest_path: &Path) -> ChronicleResult<()> {
    let parent = manifest_path.parent().ok_or_else(|| {
        ChronicleError::InvalidArgument(format!(
            "transcript manifest has no parent directory: {}",
            manifest_path.display()
        ))
    })?;
    let processed_dir = parent.join("processed");
    fs::create_dir_all(&processed_dir)
        .map_err(|source| ChronicleError::io_at(&processed_dir, source))?;
    let processed_path = processed_dir.join(manifest_path.file_name().ok_or_else(|| {
        ChronicleError::InvalidArgument("transcript manifest has no file name".to_string())
    })?);
    fs::rename(manifest_path, &processed_path)
        .map_err(|source| ChronicleError::io_at(&processed_path, source))?;
    Ok(())
}

fn process_audio_segment_if_due(
    config: &ChronicleConfig,
    outbox: &ChronicleOutbox,
    local_transcription: &LocalTranscriptionPipeline<'_>,
    last_audio_segment_time: &mut Option<Instant>,
) {
    if !config.audio_capture {
        return;
    }
    let interval = Duration::from_millis(config.audio_segment_interval_ms.max(100));
    if !audio_segment_due(*last_audio_segment_time, interval) {
        return;
    }
    process_audio_segment(config, outbox, local_transcription);
    *last_audio_segment_time = Some(Instant::now());
}

fn audio_segment_due(last_audio_segment_time: Option<Instant>, interval: Duration) -> bool {
    last_audio_segment_time.is_none_or(|last_capture| last_capture.elapsed() >= interval)
}

fn process_audio_segment(
    config: &ChronicleConfig,
    outbox: &ChronicleOutbox,
    local_transcription: &LocalTranscriptionPipeline<'_>,
) {
    match write_audio_segment(config) {
        Ok(report) => {
            eprintln!(
                "cradle chronicle audio segment written: samples={} dropped={} rms={:.6} peak={:.6} active={} wav={} metadata={}",
                report.sample_count,
                report.dropped_samples,
                report.rms,
                report.peak,
                report.active,
                report.wav_path.display(),
                report.metadata_path.display()
            );
            record_audio_raw_segment(outbox, &report);
            process_audio_transcription(outbox, &report, local_transcription);
        }
        Err(error) => {
            eprintln!("cradle chronicle audio segment error: {error}");
        }
    }
}

fn record_audio_raw_segment(outbox: &ChronicleOutbox, report: &AudioSegmentArtifactReport) {
    let source_id = audio_segment_source_id(report.source, &report.metadata_path);
    record_outbox_event(
        outbox,
        ChronicleOutboxEvent {
            id: source_id,
            kind: "audio-raw-segment".to_string(),
            created_at: report.recorded_at.clone(),
            payload: serde_json::json!({
            "sourceId": audio_segment_source_id(report.source, &report.metadata_path),
            "recordedAt": report.recorded_at,
            "source": report.source.as_str(),
            "status": "captured",
            "audioPath": artifact_path_text(&report.wav_path),
            "metadataPath": artifact_path_text(&report.metadata_path),
            "sampleRate": report.sample_rate,
            "channels": report.channels,
            "sampleCount": report.sample_count,
            "droppedSamples": report.dropped_samples,
            "durationMs": report.duration_ms,
            "rms": report.rms,
            "peak": report.peak,
            "active": report.active,
            "runtime": "local-audio-segment",
            "sourceSampleFormat": report.source_sample_format,
            "vadImplemented": true,
            "asrImplemented": true,
            "speakerLabelingImplemented": true
            }),
        },
    );
}

fn process_audio_transcription(
    outbox: &ChronicleOutbox,
    report: &AudioSegmentArtifactReport,
    local_transcription: &LocalTranscriptionPipeline<'_>,
) {
    let source_id = audio_segment_source_id(report.source, &report.metadata_path);
    if !report.active {
        record_audio_processing_result(outbox, &source_id, "ignored", None, Vec::new(), None, None);
        return;
    }

    match local_transcription.process_wav_with_fallback(
        &report.samples,
        report.sample_rate,
        &report.wav_path,
    ) {
        Ok(output) if output.result.text.trim().is_empty() => {
            record_audio_processing_result(
                outbox,
                &source_id,
                "ignored",
                None,
                Vec::new(),
                None,
                Some(output.runtime),
            );
        }
        Ok(output) => {
            let transcript_source_id = format!("transcript:{source_id}");
            let transcript = build_audio_transcript_event_payload(
                &transcript_source_id,
                report,
                &output.result,
                output.runtime,
            );
            let speaker_profile_ids = record_speaker_profiles(outbox, &output.result);
            record_outbox_event(
                outbox,
                ChronicleOutboxEvent {
                    id: transcript_source_id.clone(),
                    kind: "audio-transcript".to_string(),
                    created_at: report.recorded_at.clone(),
                    payload: transcript,
                },
            );
            record_audio_processing_result(
                outbox,
                &source_id,
                "processed",
                Some(transcript_source_id),
                speaker_profile_ids,
                None,
                Some(output.runtime),
            );
        }
        Err(error) => {
            record_audio_processing_result(
                outbox,
                &source_id,
                "error",
                None,
                Vec::new(),
                Some(error.to_string()),
                None,
            );
        }
    }
}

fn build_audio_transcript_event_payload(
    source_id: &str,
    report: &AudioSegmentArtifactReport,
    result: &TranscriptionResult,
    runtime: TranscriptionRuntime,
) -> serde_json::Value {
    let runtime_name = runtime.as_str();
    let fallback_segment = serde_json::json!({
        "startMs": 0,
        "endMs": result.duration_ms.max(report.duration_ms),
        "speakerLabel": serde_json::Value::Null,
        "text": result.text.clone(),
        "confidence": result.confidence,
        "language": result.language.clone(),
        "metadata": { "runtime": runtime_name, "source": report.source.as_str() }
    });
    let segments = if result.segments.is_empty() {
        vec![fallback_segment]
    } else {
        result
            .segments
            .iter()
            .map(|segment| {
                serde_json::json!({
                    "startMs": segment.start_ms,
                    "endMs": segment.end_ms,
                    "speakerLabel": segment.speaker_label.clone(),
                    "text": segment.text.clone(),
                    "confidence": segment.confidence,
                    "language": result.language.clone(),
                    "metadata": { "runtime": runtime_name, "source": report.source.as_str() }
                })
            })
            .collect()
    };

    serde_json::json!({
        "sourceId": source_id,
        "title": format!("{} audio transcript", report.source.as_str()),
        "source": "asr",
        "status": "completed",
        "startedAt": report.recorded_at.clone(),
        "endedAt": report.recorded_at.clone(),
        "language": result.language.clone(),
        "appBundleId": "cradle-chronicle-audio",
        "windowTitle": format!("Chronicle {} audio", report.source.as_str()),
        "audioPath": artifact_path_text(&report.wav_path),
        "transcriptPath": serde_json::Value::Null,
        "segments": segments,
        "metadata": {
            "runtime": runtime_name,
            "source": report.source.as_str(),
            "rawSourceId": audio_segment_source_id(report.source, &report.metadata_path),
            "sampleRate": report.sample_rate,
            "rms": report.rms,
            "peak": report.peak
        }
    })
}

fn record_audio_processing_result(
    outbox: &ChronicleOutbox,
    source_id: &str,
    status: &str,
    transcript_source_id: Option<String>,
    speaker_profile_ids: Vec<String>,
    error_message: Option<String>,
    runtime: Option<TranscriptionRuntime>,
) {
    let runtime_name = runtime
        .map(TranscriptionRuntime::as_str)
        .unwrap_or("sensevoice-onnx");
    record_outbox_event(
        outbox,
        ChronicleOutboxEvent {
            id: format!("raw-processing:{source_id}"),
            kind: "audio-raw-processing-result".to_string(),
            created_at: Timestamp::now()
                .map(|ts| ts.filesystem())
                .unwrap_or_else(|_| "1970-01-01T00-00-00Z".to_string()),
            payload: serde_json::json!({
                "sourceId": source_id,
                "status": status,
                "vadStatus": "ready",
                "asrStatus": if error_message.is_some() { "error" } else { "ready" },
                "speakerStatus": if error_message.is_some() { "error" } else { "ready" },
                "transcriptSourceId": transcript_source_id,
                "speakerProfileIds": speaker_profile_ids,
                "errorMessage": error_message,
                "metadata": { "runtime": runtime_name, "speakerRuntime": "local-onnx-speaker" }
            }),
        },
    );
}

fn record_speaker_profiles(outbox: &ChronicleOutbox, result: &TranscriptionResult) -> Vec<String> {
    let mut profile_ids = Vec::new();
    for profile in &result.speaker_profiles {
        let payload = serde_json::json!({
            "displayName": profile.display_name,
            "aliases": [],
            "embedding": profile.embedding,
            "embeddingModelId": profile.embedding_model_id,
            "sampleCount": profile.sample_count,
            "metadata": {
                "runtime": "local-onnx-speaker",
                "source": "audio-transcription"
            }
        });
        record_outbox_event(
            outbox,
            ChronicleOutboxEvent {
                id: format!("speaker-profile:{}", profile.display_name),
                kind: "speaker-profile".to_string(),
                created_at: Timestamp::now()
                    .map(|ts| ts.filesystem())
                    .unwrap_or_else(|_| "1970-01-01T00-00-00Z".to_string()),
                payload,
            },
        );
        profile_ids.push(profile.display_name.clone());
    }
    profile_ids
}

#[derive(Debug, Clone, PartialEq)]
struct AudioSegmentArtifactReport {
    source: AudioCaptureSource,
    recorded_at: String,
    sample_rate: u32,
    channels: u16,
    source_sample_format: String,
    sample_count: usize,
    dropped_samples: usize,
    duration_ms: u64,
    rms: f32,
    peak: f32,
    active: bool,
    samples: Vec<f32>,
    wav_path: PathBuf,
    metadata_path: PathBuf,
}

fn write_audio_segment(config: &ChronicleConfig) -> ChronicleResult<AudioSegmentArtifactReport> {
    let capture = match config.audio_source {
        AudioCaptureSource::Microphone => capture_microphone_samples(config.audio_segment_ms)?,
        AudioCaptureSource::System => capture_system_audio_samples(config.audio_segment_ms)?,
        AudioCaptureSource::Mixed => capture_mixed_audio_samples(config.audio_segment_ms)?,
    };
    let gate = RmsActivityGate::new(config.audio_rms_threshold);
    let activity = gate.analyze(&capture.samples);
    let metadata = AudioArtifactMetadata {
        recorded_at: Timestamp::now()?,
        source: config.audio_source.as_str().to_string(),
        sample_rate: capture.sample_rate,
        channels: capture.channels,
        source_sample_format: capture.source_sample_format,
        sample_count: capture.samples.len(),
        dropped_samples: capture.dropped_samples,
        rms: activity.rms,
        peak: activity.peak,
        active: activity.active,
    };
    let artifact = write_audio_segment_artifact(&config.storage_root, &capture.samples, &metadata)?;
    Ok(AudioSegmentArtifactReport {
        source: config.audio_source,
        recorded_at: metadata.recorded_at.filesystem(),
        sample_rate: metadata.sample_rate,
        channels: metadata.channels,
        source_sample_format: metadata.source_sample_format,
        sample_count: metadata.sample_count,
        dropped_samples: metadata.dropped_samples,
        duration_ms: capture.duration_ms,
        rms: metadata.rms,
        peak: metadata.peak,
        active: metadata.active,
        samples: capture.samples,
        wav_path: artifact.wav_path,
        metadata_path: artifact.metadata_path,
    })
}

fn audio_segment_source_id(source: AudioCaptureSource, metadata_path: &Path) -> String {
    let stem = metadata_path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown");
    format!("audio:{}:{stem}", source.as_str())
}

fn artifact_path_text(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

// --- System idle detection ---

#[cfg(target_os = "macos")]
fn system_idle_seconds() -> u64 {
    // CGEventSourceSecondsSinceLastEventType with kCGEventSourceStateCombinedSessionState
    unsafe extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(source_state: u32, event_type: u32) -> f64;
    }
    // kCGEventSourceStateCombinedSessionState = 0
    // kCGAnyInputEventType = 0xFFFFFFFF (all event types)
    let seconds = unsafe { CGEventSourceSecondsSinceLastEventType(0, 0xFFFF_FFFF) };
    if seconds < 0.0 { 0 } else { seconds as u64 }
}

#[cfg(not(target_os = "macos"))]
fn system_idle_seconds() -> u64 {
    // On non-macOS, always report active (no idle detection)
    0
}

// --- Signal handling ---

fn install_signal_handlers() {
    #[cfg(unix)]
    {
        use std::sync::Once;
        static INIT: Once = Once::new();
        INIT.call_once(|| unsafe {
            let mut sa: libc::sigaction = std::mem::zeroed();
            sa.sa_sigaction = signal_handler as *const () as usize;
            sa.sa_flags = libc::SA_RESTART;
            libc::sigemptyset(&mut sa.sa_mask);
            libc::sigaction(libc::SIGTERM, &sa, std::ptr::null_mut());
            libc::sigaction(libc::SIGINT, &sa, std::ptr::null_mut());
        });
    }
}

#[cfg(unix)]
extern "C" fn signal_handler(_sig: libc::c_int) {
    SHUTDOWN_REQUESTED.store(true, Ordering::Relaxed);
}

// --- Instance lock ---

struct InstanceLock {
    lock_path: PathBuf,
    #[cfg(unix)]
    _fd: std::os::unix::io::OwnedFd,
}

impl InstanceLock {
    fn acquire(storage_root: &Path) -> ChronicleResult<Self> {
        let lock_path = storage_root.join("codex_chronicle.lock");

        #[cfg(unix)]
        {
            use std::os::unix::io::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd};
            let file = fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(false)
                .open(&lock_path)
                .map_err(|e| ChronicleError::io_at(&lock_path, e))?;

            let fd = unsafe { OwnedFd::from_raw_fd(file.into_raw_fd()) };
            let result = unsafe { libc::flock(fd.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
            if result != 0 {
                return Err(ChronicleError::Process(
                    "another Chronicle instance is already running (lock held)".to_string(),
                ));
            }
            // Set CLOEXEC so child processes don't inherit the lock
            unsafe {
                libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC);
            }
            Ok(Self { lock_path, _fd: fd })
        }

        #[cfg(not(unix))]
        {
            if lock_path.exists() {
                // Check if the PID in the lock file is still alive
                if let Ok(content) = fs::read_to_string(&lock_path) {
                    if let Ok(pid) = content.trim().parse::<u32>() {
                        // On non-unix systems, we can't easily check process liveness
                        // For now, treat existing lock as held
                        let _ = pid;
                    }
                }
                return Err(ChronicleError::Process(
                    "another Chronicle instance is already running (lock file exists)".to_string(),
                ));
            }
            fs::write(&lock_path, std::process::id().to_string().as_bytes())
                .map_err(|e| ChronicleError::io_at(&lock_path, e))?;
            Ok(Self { lock_path })
        }
    }
}

impl Drop for InstanceLock {
    fn drop(&mut self) {
        // On unix, OwnedFd automatically closes the fd and releases flock
        let _ = fs::remove_file(&self.lock_path);
    }
}

// --- PID file ---

fn write_pid_file(storage_root: &Path) -> ChronicleResult<()> {
    let pid_path = storage_root.join("chronicle-started.pid");
    let mut file = fs::File::create(&pid_path).map_err(|e| ChronicleError::io_at(&pid_path, e))?;
    write!(file, "{}", std::process::id()).map_err(|e| ChronicleError::io_at(&pid_path, e))?;
    Ok(())
}

fn cleanup_pid_file(storage_root: &Path) {
    let pid_path = storage_root.join("chronicle-started.pid");
    let _ = fs::remove_file(pid_path);
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct CleanupReport {
    removed_files: usize,
    removed_dirs: usize,
    kept_files: usize,
}

const CLEANUP_PROCESSED_INBOX_RETENTION_SECS: u64 = 7 * 24 * 60 * 60;

fn cleanup_runtime_storage(storage_root: &Path, now: Timestamp) -> ChronicleResult<CleanupReport> {
    let mut report = CleanupReport::default();
    cleanup_stale_runtime_files(storage_root, &mut report)?;
    cleanup_processed_inbox(storage_root, now, &mut report)?;
    cleanup_empty_dirs(storage_root, &mut report)?;
    Ok(report)
}

fn cleanup_stale_runtime_files(
    storage_root: &Path,
    report: &mut CleanupReport,
) -> ChronicleResult<()> {
    let pid_path = storage_root.join("chronicle-started.pid");
    if !pid_path.exists() {
        return Ok(());
    }
    let content =
        fs::read_to_string(&pid_path).map_err(|error| ChronicleError::io_at(&pid_path, error))?;
    let stale = content
        .trim()
        .parse::<u32>()
        .map(|pid| pid != std::process::id() && !process_is_running(pid))
        .unwrap_or(true);
    if stale {
        match fs::remove_file(&pid_path) {
            Ok(()) => report.removed_files += 1,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ChronicleError::io_at(pid_path, error)),
        }
    } else {
        report.kept_files += 1;
    }
    Ok(())
}

#[cfg(unix)]
fn process_is_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(not(unix))]
fn process_is_running(pid: u32) -> bool {
    pid == std::process::id()
}

fn cleanup_processed_inbox(
    storage_root: &Path,
    now: Timestamp,
    report: &mut CleanupReport,
) -> ChronicleResult<()> {
    let cutoff = now
        .seconds_since_epoch()
        .saturating_sub(CLEANUP_PROCESSED_INBOX_RETENTION_SECS);
    for relative in [
        Path::new("inbox/processed"),
        Path::new("inbox/audio-transcripts/processed"),
    ] {
        remove_processed_files_older_than(&storage_root.join(relative), cutoff, report)?;
    }
    Ok(())
}

fn remove_processed_files_older_than(
    dir: &Path,
    cutoff_secs: u64,
    report: &mut CleanupReport,
) -> ChronicleResult<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|error| ChronicleError::io_at(dir, error))? {
        let entry = entry.map_err(|error| ChronicleError::io_at(dir, error))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| ChronicleError::io_at(&path, error))?;
        if file_type.is_dir() {
            remove_processed_files_older_than(&path, cutoff_secs, report)?;
            continue;
        }
        if !file_type.is_file() {
            report.kept_files += 1;
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(system_time_to_unix_secs);
        if modified.is_some_and(|modified_secs| modified_secs <= cutoff_secs) {
            fs::remove_file(&path).map_err(|error| ChronicleError::io_at(&path, error))?;
            report.removed_files += 1;
        } else {
            report.kept_files += 1;
        }
    }
    Ok(())
}

fn cleanup_empty_dirs(storage_root: &Path, report: &mut CleanupReport) -> ChronicleResult<()> {
    for relative in [
        Path::new("inbox/processed"),
        Path::new("inbox/audio-transcripts/processed"),
    ] {
        remove_empty_dirs(&storage_root.join(relative), report)?;
    }
    Ok(())
}

fn remove_empty_dirs(dir: &Path, report: &mut CleanupReport) -> ChronicleResult<bool> {
    if !dir.exists() {
        return Ok(false);
    }
    let mut is_empty = true;
    for entry in fs::read_dir(dir).map_err(|error| ChronicleError::io_at(dir, error))? {
        let entry = entry.map_err(|error| ChronicleError::io_at(dir, error))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| ChronicleError::io_at(&path, error))?;
        if file_type.is_dir() {
            if !remove_empty_dirs(&path, report)? {
                is_empty = false;
            }
        } else {
            is_empty = false;
        }
    }
    if is_empty {
        match fs::remove_dir(dir) {
            Ok(()) => {
                report.removed_dirs += 1;
                Ok(true)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => Ok(false),
            Err(error) => Err(ChronicleError::io_at(dir, error)),
        }
    } else {
        Ok(false)
    }
}

fn system_time_to_unix_secs(time: SystemTime) -> Option<u64> {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::SystemTime;
    use std::time::{Duration, Instant};

    use super::InstanceLock;

    #[test]
    fn lock_acquires_and_releases() {
        let root =
            std::env::temp_dir().join(format!("cradle-chronicle-lock-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let lock = InstanceLock::acquire(&root).expect("should acquire lock");
        let lock_path = root.join("codex_chronicle.lock");
        assert!(lock_path.exists());

        drop(lock);
        assert!(!lock_path.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn second_lock_fails() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-lock-test2-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let _lock1 = InstanceLock::acquire(&root).expect("first lock should succeed");
        let result = InstanceLock::acquire(&root);
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pid_file_written_and_cleaned() {
        let root =
            std::env::temp_dir().join(format!("cradle-chronicle-pid-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        super::write_pid_file(&root).expect("should write pid");
        let pid_path = root.join("chronicle-started.pid");
        assert!(pid_path.exists());
        let content = fs::read_to_string(&pid_path).unwrap();
        assert_eq!(content, std::process::id().to_string());

        super::cleanup_pid_file(&root);
        assert!(!pid_path.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn audio_segment_due_respects_interval() {
        let interval = Duration::from_millis(1_000);
        let recent = Some(Instant::now());
        let older = Some(Instant::now() - Duration::from_millis(1_500));

        assert!(!super::audio_segment_due(recent, interval));
        assert!(super::audio_segment_due(older, interval));
        assert!(super::audio_segment_due(None, interval));
    }

    #[test]
    fn cleanup_runtime_storage_keeps_evidence_and_removes_old_processed_inbox() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-cleanup-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let processed = root.join("inbox/audio-transcripts/processed");
        fs::create_dir_all(&processed).unwrap();
        let old_processed = processed.join("old.json");
        let current_processed = processed.join("current.json");
        fs::write(&old_processed, b"old").unwrap();
        fs::write(&current_processed, b"current").unwrap();

        set_file_mtime(
            &old_processed,
            SystemTime::UNIX_EPOCH + Duration::from_secs(100),
        );
        set_file_mtime(
            &current_processed,
            SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000),
        );

        let evidence_dir = root.join("1/2026-05-21T10-00-00Z");
        fs::create_dir_all(&evidence_dir).unwrap();
        let snapshot = evidence_dir.join("snapshot.json");
        fs::write(&snapshot, b"{}").unwrap();

        let stale_pid = root.join("chronicle-started.pid");
        fs::write(&stale_pid, b"999999").unwrap();

        let report =
            super::cleanup_runtime_storage(&root, crate::time::Timestamp::from_seconds(1_000_000))
                .expect("cleanup should succeed");

        assert!(report.removed_files >= 2);
        assert!(!old_processed.exists());
        assert!(!stale_pid.exists());
        assert!(current_processed.exists());
        assert!(snapshot.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    fn set_file_mtime(path: &std::path::Path, time: SystemTime) {
        use std::os::unix::ffi::OsStrExt;

        let secs = time
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("mtime should be after epoch")
            .as_secs() as libc::time_t;
        let c_path = std::ffi::CString::new(path.as_os_str().as_bytes())
            .expect("test path should not contain nul");
        let times = [
            libc::timespec {
                tv_sec: secs,
                tv_nsec: 0,
            },
            libc::timespec {
                tv_sec: secs,
                tv_nsec: 0,
            },
        ];
        let result = unsafe { libc::utimensat(libc::AT_FDCWD, c_path.as_ptr(), times.as_ptr(), 0) };
        assert_eq!(result, 0);
    }

    #[cfg(not(unix))]
    fn set_file_mtime(_path: &std::path::Path, _time: SystemTime) {}
}
