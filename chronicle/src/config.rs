//! Runtime configuration for Cradle Chronicle.

use std::env;
use std::path::PathBuf;

use crate::error::{ChronicleError, ChronicleResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureProvider {
    Macos,
    Inbox,
}

impl CaptureProvider {
    pub fn parse(s: &str) -> ChronicleResult<Self> {
        match s {
            "macos" => Ok(Self::Macos),
            "inbox" => Ok(Self::Inbox),
            other => Err(ChronicleError::InvalidArgument(format!(
                "unsupported provider: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioCaptureSource {
    Microphone,
    System,
    Mixed,
}

impl AudioCaptureSource {
    pub fn parse(s: &str) -> ChronicleResult<Self> {
        match s {
            "microphone" => Ok(Self::Microphone),
            "system" => Ok(Self::System),
            "mixed" => Ok(Self::Mixed),
            other => Err(ChronicleError::InvalidArgument(format!(
                "unsupported audio source: {other}"
            ))),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::System => "system",
            Self::Mixed => "mixed",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChronicleConfig {
    pub storage_root: PathBuf,
    pub inbox_root: PathBuf,
    pub provider: CaptureProvider,
    pub display_id: Option<u32>,
    pub capture_limit: usize,
    pub poll_interval_ms: u64,
    pub idle_timeout_seconds: u64,
    pub min_interval_ms: u64,
    pub max_interval_ms: u64,
    pub smoke: bool,
    pub daemon: bool,
    pub run_once: bool,
    pub audio_diagnostics: bool,
    pub audio_capture: bool,
    pub audio_source: AudioCaptureSource,
    pub audio_duration_ms: u64,
    pub audio_segment_ms: u64,
    pub audio_segment_interval_ms: u64,
    pub audio_rms_threshold: f32,
    pub ax_observer: bool,
    pub privacy_sensitive_app_bundle_ids: Vec<String>,
    pub privacy_sensitive_title_patterns: Vec<String>,
    pub privacy_sensitive_url_patterns: Vec<String>,
}

impl ChronicleConfig {
    pub fn from_env_args() -> ChronicleResult<Self> {
        Self::from_args(env::args().skip(1))
    }

    pub fn from_args<I, S>(args: I) -> ChronicleResult<Self>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut storage_root = env::var_os("STORAGE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("./.cradle/chronicle"));
        let mut inbox_root = env::var_os("CHRONICLE_INBOX_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| storage_root.join("inbox"));
        let mut provider = match env::var("CRADLE_CHRONICLE_PROVIDER").as_deref() {
            Ok("macos") => CaptureProvider::Macos,
            Ok("inbox") => CaptureProvider::Inbox,
            Ok(other) => {
                return Err(ChronicleError::InvalidArgument(format!(
                    "unsupported CRADLE_CHRONICLE_PROVIDER: {other}"
                )));
            }
            Err(_) => {
                if cfg!(target_os = "macos") {
                    CaptureProvider::Macos
                } else {
                    CaptureProvider::Inbox
                }
            }
        };
        let mut display_id = None;
        let mut capture_limit = 3;
        let mut poll_interval_ms = 5_000;
        let mut idle_timeout_seconds = 300;
        let mut min_interval_ms = 2_000;
        let mut max_interval_ms = 30_000;
        let mut smoke = false;
        let mut daemon = false;
        let mut run_once = false;
        let mut audio_diagnostics = false;
        let mut audio_capture = env_flag("CRADLE_CHRONICLE_AUDIO_CAPTURE");
        let mut audio_source = env::var("CRADLE_CHRONICLE_AUDIO_SOURCE")
            .ok()
            .map(|value| AudioCaptureSource::parse(&value))
            .transpose()?
            .unwrap_or(AudioCaptureSource::Microphone);
        let mut audio_duration_ms = 1_000;
        let mut audio_segment_ms = 5_000;
        let mut audio_segment_interval_ms = 60_000;
        let mut audio_rms_threshold = 0.02;
        let mut ax_observer = !env_flag("CRADLE_CHRONICLE_NO_AX_OBSERVER");
        let mut privacy_sensitive_app_bundle_ids = Vec::new();
        let mut privacy_sensitive_title_patterns = Vec::new();
        let mut privacy_sensitive_url_patterns = Vec::new();

        let mut iterator = args.into_iter().map(Into::into).peekable();
        while let Some(arg) = iterator.next() {
            if arg == "--smoke" {
                smoke = true;
            } else if arg == "--daemon" {
                daemon = true;
            } else if arg == "--audio-diagnostics" {
                audio_diagnostics = true;
            } else if arg == "--audio-capture" {
                audio_capture = true;
            } else if arg == "--no-audio-capture" {
                audio_capture = false;
            } else if let Some(value) = arg.strip_prefix("--audio-source=") {
                audio_source = AudioCaptureSource::parse(value)?;
            } else if arg == "--audio-source" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--audio-source requires a value".to_string())
                })?;
                audio_source = AudioCaptureSource::parse(&value)?;
            } else if arg == "--ax-observer" {
                ax_observer = true;
            } else if arg == "--no-ax-observer" {
                ax_observer = false;
            } else if let Some(value) = arg.strip_prefix("--privacy-sensitive-app=") {
                push_non_empty(&mut privacy_sensitive_app_bundle_ids, value);
            } else if arg == "--privacy-sensitive-app" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument(
                        "--privacy-sensitive-app requires a value".to_string(),
                    )
                })?;
                push_non_empty(&mut privacy_sensitive_app_bundle_ids, &value);
            } else if let Some(value) = arg.strip_prefix("--privacy-sensitive-title=") {
                push_non_empty(&mut privacy_sensitive_title_patterns, value);
            } else if arg == "--privacy-sensitive-title" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument(
                        "--privacy-sensitive-title requires a value".to_string(),
                    )
                })?;
                push_non_empty(&mut privacy_sensitive_title_patterns, &value);
            } else if let Some(value) = arg.strip_prefix("--privacy-sensitive-url=") {
                push_non_empty(&mut privacy_sensitive_url_patterns, value);
            } else if arg == "--privacy-sensitive-url" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument(
                        "--privacy-sensitive-url requires a value".to_string(),
                    )
                })?;
                push_non_empty(&mut privacy_sensitive_url_patterns, &value);
            } else if arg == "--run-once" {
                run_once = true;
            } else if let Some(value) = arg.strip_prefix("--storage-root=") {
                storage_root = PathBuf::from(value);
                if env::var_os("CHRONICLE_INBOX_ROOT").is_none() {
                    inbox_root = storage_root.join("inbox");
                }
            } else if arg == "--storage-root" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--storage-root requires a value".to_string())
                })?;
                storage_root = PathBuf::from(value);
                if env::var_os("CHRONICLE_INBOX_ROOT").is_none() {
                    inbox_root = storage_root.join("inbox");
                }
            } else if let Some(value) = arg.strip_prefix("--inbox-root=") {
                inbox_root = PathBuf::from(value);
            } else if arg == "--inbox-root" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--inbox-root requires a value".to_string())
                })?;
                inbox_root = PathBuf::from(value);
            } else if let Some(value) = arg.strip_prefix("--provider=") {
                provider = CaptureProvider::parse(value)?;
            } else if arg == "--provider" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--provider requires a value".to_string())
                })?;
                provider = CaptureProvider::parse(&value)?;
            } else if let Some(value) = arg.strip_prefix("--display-id=") {
                display_id = Some(parse_u32("--display-id", value)?);
            } else if arg == "--display-id" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--display-id requires a value".to_string())
                })?;
                display_id = Some(parse_u32("--display-id", &value)?);
            } else if let Some(value) = arg.strip_prefix("--capture-limit=") {
                capture_limit = parse_usize("--capture-limit", value)?;
            } else if arg == "--capture-limit" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--capture-limit requires a value".to_string())
                })?;
                capture_limit = parse_usize("--capture-limit", &value)?;
            } else if let Some(value) = arg.strip_prefix("--poll-ms=") {
                poll_interval_ms = parse_u64("--poll-ms", value)?;
            } else if arg == "--poll-ms" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--poll-ms requires a value".to_string())
                })?;
                poll_interval_ms = parse_u64("--poll-ms", &value)?;
            } else if let Some(value) = arg.strip_prefix("--idle-timeout=") {
                idle_timeout_seconds = parse_u64("--idle-timeout", value)?;
            } else if arg == "--idle-timeout" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument("--idle-timeout requires a value".to_string())
                })?;
                idle_timeout_seconds = parse_u64("--idle-timeout", &value)?;
            } else if let Some(value) = arg.strip_prefix("--min-interval-ms=") {
                min_interval_ms = parse_u64("--min-interval-ms", value)?;
            } else if arg == "--min-interval-ms" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument(
                        "--min-interval-ms requires a value".to_string(),
                    )
                })?;
                min_interval_ms = parse_u64("--min-interval-ms", &value)?;
            } else if let Some(value) = arg.strip_prefix("--max-interval-ms=") {
                max_interval_ms = parse_u64("--max-interval-ms", value)?;
            } else if arg == "--max-interval-ms" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument(
                        "--max-interval-ms requires a value".to_string(),
                    )
                })?;
                max_interval_ms = parse_u64("--max-interval-ms", &value)?;
            } else if let Some(value) = arg.strip_prefix("--audio-duration-ms=") {
                audio_duration_ms = parse_u64("--audio-duration-ms", value)?;
            } else if arg == "--audio-duration-ms" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument(
                        "--audio-duration-ms requires a value".to_string(),
                    )
                })?;
                audio_duration_ms = parse_u64("--audio-duration-ms", &value)?;
            } else if let Some(value) = arg.strip_prefix("--audio-segment-ms=") {
                audio_segment_ms = parse_u64("--audio-segment-ms", value)?;
            } else if arg == "--audio-segment-ms" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument(
                        "--audio-segment-ms requires a value".to_string(),
                    )
                })?;
                audio_segment_ms = parse_u64("--audio-segment-ms", &value)?;
            } else if let Some(value) = arg.strip_prefix("--audio-segment-interval-ms=") {
                audio_segment_interval_ms = parse_u64("--audio-segment-interval-ms", value)?;
            } else if arg == "--audio-segment-interval-ms" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument(
                        "--audio-segment-interval-ms requires a value".to_string(),
                    )
                })?;
                audio_segment_interval_ms = parse_u64("--audio-segment-interval-ms", &value)?;
            } else if let Some(value) = arg.strip_prefix("--audio-rms-threshold=") {
                audio_rms_threshold = parse_f32("--audio-rms-threshold", value)?;
            } else if arg == "--audio-rms-threshold" {
                let value = iterator.next().ok_or_else(|| {
                    ChronicleError::InvalidArgument(
                        "--audio-rms-threshold requires a value".to_string(),
                    )
                })?;
                audio_rms_threshold = parse_f32("--audio-rms-threshold", &value)?;
            } else if arg == "--help" || arg == "-h" {
                return Err(ChronicleError::InvalidArgument(usage()));
            } else {
                return Err(ChronicleError::InvalidArgument(format!(
                    "unknown argument: {arg}\n{}",
                    usage()
                )));
            }
        }

        if capture_limit == 0 {
            return Err(ChronicleError::InvalidArgument(
                "--capture-limit must be greater than zero".to_string(),
            ));
        }

        Ok(Self {
            storage_root,
            inbox_root,
            provider,
            display_id,
            capture_limit,
            poll_interval_ms,
            idle_timeout_seconds,
            min_interval_ms,
            max_interval_ms,
            smoke,
            daemon,
            run_once,
            audio_diagnostics,
            audio_capture,
            audio_source,
            audio_duration_ms,
            audio_segment_ms,
            audio_segment_interval_ms,
            audio_rms_threshold,
            ax_observer,
            privacy_sensitive_app_bundle_ids,
            privacy_sensitive_title_patterns,
            privacy_sensitive_url_patterns,
        })
    }
}

pub fn usage() -> String {
    "usage: cradle-chronicle (--smoke | --daemon | --audio-diagnostics | --embed-texts | --redact-pii | --transcribe-wav <path> | --embed-speaker-wav <path> | --inspect-onnx <path>) [--provider macos|inbox] [--storage-root <path>] [--inbox-root <path>] [--display-id <id>] [--capture-limit <count>] [--poll-ms <ms>] [--idle-timeout <seconds>] [--min-interval-ms <ms>] [--max-interval-ms <ms>] [--audio-capture] [--no-audio-capture] [--audio-source microphone|system|mixed] [--ax-observer] [--no-ax-observer] [--privacy-sensitive-app <bundle-id>] [--privacy-sensitive-title <pattern>] [--privacy-sensitive-url <pattern>] [--audio-duration-ms <ms>] [--audio-segment-ms <ms>] [--audio-segment-interval-ms <ms>] [--audio-rms-threshold <value>] [--run-once]".to_string()
}

fn push_non_empty(values: &mut Vec<String>, value: &str) {
    let trimmed = value.trim();
    if !trimmed.is_empty() && !values.iter().any(|existing| existing == trimmed) {
        values.push(trimmed.to_string());
    }
}

fn env_flag(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref(),
        Some("1")
            | Some("true")
            | Some("TRUE")
            | Some("yes")
            | Some("YES")
            | Some("on")
            | Some("ON")
    )
}

fn parse_u32(name: &str, value: &str) -> ChronicleResult<u32> {
    value
        .parse::<u32>()
        .map_err(|_| ChronicleError::InvalidArgument(format!("{name} must be an unsigned integer")))
}

fn parse_usize(name: &str, value: &str) -> ChronicleResult<usize> {
    value
        .parse::<usize>()
        .map_err(|_| ChronicleError::InvalidArgument(format!("{name} must be an unsigned integer")))
}

fn parse_u64(name: &str, value: &str) -> ChronicleResult<u64> {
    value
        .parse::<u64>()
        .map_err(|_| ChronicleError::InvalidArgument(format!("{name} must be an unsigned integer")))
}

fn parse_f32(name: &str, value: &str) -> ChronicleResult<f32> {
    let parsed = value
        .parse::<f32>()
        .map_err(|_| ChronicleError::InvalidArgument(format!("{name} must be a number")))?;
    if parsed.is_finite() && parsed >= 0.0 {
        Ok(parsed)
    } else {
        Err(ChronicleError::InvalidArgument(format!(
            "{name} must be a finite non-negative number"
        )))
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{AudioCaptureSource, CaptureProvider, ChronicleConfig};

    #[test]
    fn parses_storage_root_forms() {
        let config = ChronicleConfig::from_args([
            "--smoke",
            "--storage-root",
            "/tmp/cradle-chronicle-test",
            "--capture-limit=2",
        ])
        .expect("config should parse");

        assert!(config.smoke);
        assert_eq!(
            config.storage_root,
            PathBuf::from("/tmp/cradle-chronicle-test")
        );
        assert_eq!(
            config.inbox_root,
            PathBuf::from("/tmp/cradle-chronicle-test/inbox")
        );
        assert_eq!(config.display_id, None);
        assert_eq!(config.capture_limit, 2);
    }

    #[test]
    fn parses_daemon_options() {
        let config = ChronicleConfig::from_args([
            "--daemon",
            "--storage-root",
            "/tmp/cradle-chronicle",
            "--inbox-root",
            "/tmp/cradle-inbox",
            "--poll-ms",
            "25",
            "--provider",
            "inbox",
            "--run-once",
        ])
        .expect("config should parse");

        assert!(config.daemon);
        assert!(config.run_once);
        assert!(!config.audio_diagnostics);
        assert!(!config.audio_capture);
        assert_eq!(config.audio_source, AudioCaptureSource::Microphone);
        assert!(config.ax_observer);
        assert_eq!(config.inbox_root, PathBuf::from("/tmp/cradle-inbox"));
        assert_eq!(config.provider, CaptureProvider::Inbox);
        assert_eq!(config.poll_interval_ms, 25);
    }

    #[test]
    fn parses_display_id_as_explicit_override() {
        let config = ChronicleConfig::from_args(["--daemon", "--display-id", "42"])
            .expect("config should parse");

        assert_eq!(config.display_id, Some(42));
    }

    #[test]
    fn rejects_zero_capture_limit() {
        let error = ChronicleConfig::from_args(["--capture-limit=0"]).unwrap_err();
        assert!(error.to_string().contains("greater than zero"));
    }

    #[test]
    fn parses_audio_diagnostics_options() {
        let config = ChronicleConfig::from_args([
            "--audio-diagnostics",
            "--audio-duration-ms",
            "250",
            "--audio-rms-threshold=0.05",
        ])
        .expect("config should parse");

        assert!(config.audio_diagnostics);
        assert_eq!(config.audio_duration_ms, 250);
        assert_eq!(config.audio_rms_threshold, 0.05);
    }

    #[test]
    fn parses_audio_capture_options() {
        let config = ChronicleConfig::from_args([
            "--daemon",
            "--audio-capture",
            "--no-ax-observer",
            "--audio-segment-ms=750",
            "--audio-source",
            "mixed",
            "--audio-segment-interval-ms",
            "1250",
            "--audio-rms-threshold",
            "0.03",
        ])
        .expect("config should parse");

        assert!(config.audio_capture);
        assert_eq!(config.audio_source, AudioCaptureSource::Mixed);
        assert!(!config.ax_observer);
        assert_eq!(config.audio_segment_ms, 750);
        assert_eq!(config.audio_segment_interval_ms, 1250);
        assert_eq!(config.audio_rms_threshold, 0.03);
    }

    #[test]
    fn parses_configured_privacy_rules() {
        let config = ChronicleConfig::from_args([
            "--daemon",
            "--privacy-sensitive-app",
            "com.apple.Terminal",
            "--privacy-sensitive-app=com.example.Secret",
            "--privacy-sensitive-title",
            "Bank Dashboard",
            "--privacy-sensitive-url=admin.example.com",
        ])
        .expect("config should parse");

        assert_eq!(
            config.privacy_sensitive_app_bundle_ids,
            vec![
                "com.apple.Terminal".to_string(),
                "com.example.Secret".to_string()
            ]
        );
        assert_eq!(
            config.privacy_sensitive_title_patterns,
            vec!["Bank Dashboard".to_string()]
        );
        assert_eq!(
            config.privacy_sensitive_url_patterns,
            vec!["admin.example.com".to_string()]
        );
    }

    #[test]
    fn usage_lists_direct_local_model_diagnostics() {
        let text = super::usage();
        assert!(text.contains("--transcribe-wav <path>"));
        assert!(text.contains("--embed-speaker-wav <path>"));
        assert!(text.contains("--inspect-onnx <path>"));
        assert!(text.contains("--privacy-sensitive-app <bundle-id>"));
    }

    #[test]
    fn parses_explicit_ax_observer_option() {
        let config =
            ChronicleConfig::from_args(["--daemon", "--ax-observer"]).expect("config should parse");

        assert!(config.ax_observer);
    }
}
