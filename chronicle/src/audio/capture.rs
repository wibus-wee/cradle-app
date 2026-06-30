//! Microphone diagnostics capture through CPAL.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::audio::activity::{AudioActivityReport, BoundedPcmBuffer, RmsActivityGate};
use crate::audio::wav::{AudioArtifactMetadata, WavArtifact, write_audio_diagnostics_artifact};
use crate::error::{ChronicleError, ChronicleResult};
use crate::time::Timestamp;

#[cfg(target_os = "macos")]
#[path = "screen_capture_kit_audio.rs"]
mod screen_capture_kit_audio;

const DEFAULT_AUDIO_SAMPLE_LIMIT: usize = 960_000;
const MIXED_AUDIO_SAMPLE_RATE: u32 = 16_000;

#[derive(Debug, Clone, PartialEq)]
pub struct AudioDiagnosticsReport {
    pub device_name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub source_sample_format: String,
    pub duration_ms: u64,
    pub sample_count: usize,
    pub dropped_samples: usize,
    pub activity: AudioActivityReport,
    pub artifact: WavArtifact,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MicrophoneCaptureReport {
    pub device_name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub source_sample_format: String,
    pub duration_ms: u64,
    pub samples: Vec<f32>,
    pub dropped_samples: usize,
}

pub fn capture_system_audio_samples(duration_ms: u64) -> ChronicleResult<MicrophoneCaptureReport> {
    let duration_ms = duration_ms.clamp(100, 30_000);
    #[cfg(target_os = "macos")]
    if std::env::var("CRADLE_CHRONICLE_SYSTEM_AUDIO_BACKEND")
        .map(|backend| backend.trim().eq_ignore_ascii_case("cpal"))
        .unwrap_or(false)
    {
        return capture_system_audio_samples_with_cpal(duration_ms);
    }
    #[cfg(target_os = "macos")]
    return match screen_capture_kit_audio::capture_system_audio_samples(duration_ms) {
        Ok(report) => return Ok(report),
        Err(screen_capture_error) => match capture_system_audio_samples_with_cpal(duration_ms) {
            Ok(mut report) => {
                report.source_sample_format = format!(
                    "{}; fallback_after_screencapturekit_error={}",
                    report.source_sample_format, screen_capture_error
                );
                return Ok(report);
            }
            Err(cpal_error) => Err(ChronicleError::Process(format!(
                "ScreenCaptureKit system audio failed: {screen_capture_error}; CPAL loopback fallback failed: {cpal_error}"
            ))),
        },
    };

    #[cfg(not(target_os = "macos"))]
    capture_system_audio_samples_with_cpal(duration_ms)
}

fn capture_system_audio_samples_with_cpal(
    duration_ms: u64,
) -> ChronicleResult<MicrophoneCaptureReport> {
    let host = cpal::default_host();
    let device = select_system_audio_input_device(&host)?;
    capture_from_input_device(device, duration_ms, "system-audio")
}

pub fn capture_mixed_audio_samples(duration_ms: u64) -> ChronicleResult<MicrophoneCaptureReport> {
    let microphone_handle = thread::spawn(move || capture_microphone_samples(duration_ms));
    let system_handle = thread::spawn(move || capture_system_audio_samples(duration_ms));
    let microphone = join_capture_thread(microphone_handle, "microphone")?;
    let system = join_capture_thread(system_handle, "system audio")?;
    let samples = mix_mono_sources(
        &microphone.samples,
        microphone.sample_rate,
        &system.samples,
        system.sample_rate,
        MIXED_AUDIO_SAMPLE_RATE,
    );

    Ok(MicrophoneCaptureReport {
        device_name: format!("{} + {}", microphone.device_name, system.device_name),
        sample_rate: MIXED_AUDIO_SAMPLE_RATE,
        channels: 1,
        source_sample_format: format!(
            "mixed:resampled-{}:{}+{}",
            MIXED_AUDIO_SAMPLE_RATE, microphone.source_sample_format, system.source_sample_format
        ),
        duration_ms: microphone.duration_ms.max(system.duration_ms),
        samples,
        dropped_samples: microphone.dropped_samples + system.dropped_samples,
    })
}

fn join_capture_thread(
    handle: thread::JoinHandle<ChronicleResult<MicrophoneCaptureReport>>,
    label: &str,
) -> ChronicleResult<MicrophoneCaptureReport> {
    handle
        .join()
        .map_err(|_| ChronicleError::Process(format!("{label} capture thread panicked")))?
}

fn mix_mono_sources(
    microphone: &[f32],
    microphone_sample_rate: u32,
    system: &[f32],
    system_sample_rate: u32,
    target_sample_rate: u32,
) -> Vec<f32> {
    let microphone = resample_linear(microphone, microphone_sample_rate, target_sample_rate);
    let system = resample_linear(system, system_sample_rate, target_sample_rate);
    let max_len = microphone.len().max(system.len());
    let mut samples = Vec::with_capacity(max_len);
    for index in 0..max_len {
        let microphone_sample = microphone.get(index).copied().unwrap_or(0.0);
        let system_sample = system.get(index).copied().unwrap_or(0.0);
        samples.push(((microphone_sample + system_sample) * 0.5).clamp(-1.0, 1.0));
    }
    samples
}

fn resample_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == target_rate || source_rate == 0 || target_rate == 0 {
        return samples.to_vec();
    }
    let ratio = source_rate as f64 / target_rate as f64;
    let output_len = ((samples.len() as f64) / ratio).round().max(1.0) as usize;
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let source_position = index as f64 * ratio;
        let left = source_position.floor() as usize;
        let right = (left + 1).min(samples.len() - 1);
        let fraction = (source_position - left as f64) as f32;
        output.push(samples[left] * (1.0 - fraction) + samples[right] * fraction);
    }
    output
}

pub fn record_microphone_diagnostics(
    storage_root: impl AsRef<Path>,
    duration_ms: u64,
    rms_threshold: f32,
) -> ChronicleResult<AudioDiagnosticsReport> {
    let capture = capture_microphone_samples(duration_ms)?;
    let gate = RmsActivityGate::new(rms_threshold);
    let activity = gate.analyze(&capture.samples);
    let recorded_at = Timestamp::now()?;
    let artifact_metadata = AudioArtifactMetadata {
        recorded_at,
        source: "microphone".to_string(),
        sample_rate: capture.sample_rate,
        channels: capture.channels,
        source_sample_format: capture.source_sample_format.clone(),
        sample_count: capture.samples.len(),
        dropped_samples: capture.dropped_samples,
        rms: activity.rms,
        peak: activity.peak,
        active: activity.active,
    };
    let artifact =
        write_audio_diagnostics_artifact(storage_root, &capture.samples, &artifact_metadata)?;

    Ok(AudioDiagnosticsReport {
        device_name: capture.device_name,
        sample_rate: capture.sample_rate,
        channels: capture.channels,
        source_sample_format: capture.source_sample_format,
        duration_ms: capture.duration_ms,
        sample_count: artifact_metadata.sample_count,
        dropped_samples: artifact_metadata.dropped_samples,
        activity,
        artifact,
    })
}

pub fn capture_microphone_samples(duration_ms: u64) -> ChronicleResult<MicrophoneCaptureReport> {
    let duration_ms = duration_ms.clamp(100, 30_000);
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| ChronicleError::Process("no default microphone input device".to_string()))?;
    capture_from_input_device(device, duration_ms, "microphone")
}

fn capture_from_input_device(
    device: cpal::Device,
    duration_ms: u64,
    source_label: &str,
) -> ChronicleResult<MicrophoneCaptureReport> {
    let device_name = device
        .description()
        .map(|description| description.name().to_string())
        .unwrap_or_else(|_| format!("unknown {source_label} input"));
    let supported_config = device.default_input_config().map_err(|source| {
        ChronicleError::Process(format!(
            "failed to read default microphone config: {source}"
        ))
    })?;
    let sample_rate = supported_config.sample_rate();
    let channels = supported_config.channels();
    let source_sample_format = supported_config.sample_format().to_string();
    let stream_config = supported_config.config();
    let max_samples = ((sample_rate as usize * duration_ms as usize) / 1000)
        .saturating_add(sample_rate as usize)
        .min(DEFAULT_AUDIO_SAMPLE_LIMIT);
    let buffer = Arc::new(Mutex::new(BoundedPcmBuffer::new(max_samples)));
    let error_log = Arc::new(Mutex::new(Vec::<String>::new()));
    let channel_count = usize::from(channels.max(1));

    let stream = match supported_config.sample_format() {
        cpal::SampleFormat::F32 => {
            let callback_buffer = Arc::clone(&buffer);
            device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| push_f32_samples(data, channel_count, &callback_buffer),
                stream_error_handler(Arc::clone(&error_log)),
                None,
            )
        }
        cpal::SampleFormat::F64 => {
            let callback_buffer = Arc::clone(&buffer);
            device.build_input_stream(
                &stream_config,
                move |data: &[f64], _| push_f64_samples(data, channel_count, &callback_buffer),
                stream_error_handler(Arc::clone(&error_log)),
                None,
            )
        }
        cpal::SampleFormat::I8 => {
            let callback_buffer = Arc::clone(&buffer);
            device.build_input_stream(
                &stream_config,
                move |data: &[i8], _| {
                    push_signed_samples(data, i8::MAX as f32, channel_count, &callback_buffer)
                },
                stream_error_handler(Arc::clone(&error_log)),
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let callback_buffer = Arc::clone(&buffer);
            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    push_signed_samples(data, i16::MAX as f32, channel_count, &callback_buffer)
                },
                stream_error_handler(Arc::clone(&error_log)),
                None,
            )
        }
        cpal::SampleFormat::I32 => {
            let callback_buffer = Arc::clone(&buffer);
            device.build_input_stream(
                &stream_config,
                move |data: &[i32], _| {
                    push_signed_samples(data, i32::MAX as f32, channel_count, &callback_buffer)
                },
                stream_error_handler(Arc::clone(&error_log)),
                None,
            )
        }
        cpal::SampleFormat::I64 => {
            let callback_buffer = Arc::clone(&buffer);
            device.build_input_stream(
                &stream_config,
                move |data: &[i64], _| {
                    push_signed_samples(data, i64::MAX as f32, channel_count, &callback_buffer)
                },
                stream_error_handler(Arc::clone(&error_log)),
                None,
            )
        }
        cpal::SampleFormat::U8 => {
            let callback_buffer = Arc::clone(&buffer);
            device.build_input_stream(
                &stream_config,
                move |data: &[u8], _| {
                    push_unsigned_samples(data, u8::MAX as f32, channel_count, &callback_buffer)
                },
                stream_error_handler(Arc::clone(&error_log)),
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let callback_buffer = Arc::clone(&buffer);
            device.build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    push_unsigned_samples(data, u16::MAX as f32, channel_count, &callback_buffer)
                },
                stream_error_handler(Arc::clone(&error_log)),
                None,
            )
        }
        cpal::SampleFormat::U32 => {
            let callback_buffer = Arc::clone(&buffer);
            device.build_input_stream(
                &stream_config,
                move |data: &[u32], _| {
                    push_unsigned_samples(data, u32::MAX as f32, channel_count, &callback_buffer)
                },
                stream_error_handler(Arc::clone(&error_log)),
                None,
            )
        }
        cpal::SampleFormat::U64 => {
            let callback_buffer = Arc::clone(&buffer);
            device.build_input_stream(
                &stream_config,
                move |data: &[u64], _| {
                    push_unsigned_samples(data, u64::MAX as f32, channel_count, &callback_buffer)
                },
                stream_error_handler(Arc::clone(&error_log)),
                None,
            )
        }
        other => {
            return Err(ChronicleError::Process(format!(
                "unsupported microphone sample format: {other}"
            )));
        }
    }
    .map_err(|source| {
        ChronicleError::Process(format!("failed to build microphone stream: {source}"))
    })?;

    stream.play().map_err(|source| {
        ChronicleError::Process(format!("failed to start microphone stream: {source}"))
    })?;
    thread::sleep(Duration::from_millis(duration_ms));
    drop(stream);

    let errors = error_log
        .lock()
        .map_err(|_| ChronicleError::Process("microphone error log lock poisoned".to_string()))?;
    if let Some(first_error) = errors.first() {
        return Err(ChronicleError::Process(format!(
            "microphone stream error: {first_error}"
        )));
    }
    drop(errors);

    let buffer = buffer
        .lock()
        .map_err(|_| ChronicleError::Process("microphone buffer lock poisoned".to_string()))?;

    Ok(MicrophoneCaptureReport {
        device_name,
        sample_rate,
        channels,
        source_sample_format,
        duration_ms,
        samples: buffer.samples().to_vec(),
        dropped_samples: buffer.dropped_samples(),
    })
}

fn select_system_audio_input_device(host: &cpal::Host) -> ChronicleResult<cpal::Device> {
    if let Ok(requested_name) = std::env::var("CRADLE_CHRONICLE_SYSTEM_AUDIO_DEVICE") {
        let requested_name = requested_name.trim().to_lowercase();
        if !requested_name.is_empty() {
            for device in host.input_devices().map_err(|source| {
                ChronicleError::Process(format!(
                    "failed to enumerate audio input devices: {source}"
                ))
            })? {
                let name = device
                    .description()
                    .map(|description| description.name().to_lowercase())
                    .unwrap_or_default();
                if name.contains(&requested_name) {
                    return Ok(device);
                }
            }
            return Err(ChronicleError::Process(format!(
                "system audio input device matching '{requested_name}' was not found"
            )));
        }
    }

    let system_markers = [
        "blackhole",
        "loopback",
        "soundflower",
        "monitor",
        "system audio",
        "background music",
    ];
    for device in host.input_devices().map_err(|source| {
        ChronicleError::Process(format!("failed to enumerate audio input devices: {source}"))
    })? {
        let name = device
            .description()
            .map(|description| description.name().to_lowercase())
            .unwrap_or_default();
        if system_markers.iter().any(|marker| name.contains(marker)) {
            return Ok(device);
        }
    }

    Err(ChronicleError::Process(
        "no system audio loopback input device found; set CRADLE_CHRONICLE_SYSTEM_AUDIO_DEVICE to a loopback capture device".to_string(),
    ))
}

fn stream_error_handler(
    error_log: Arc<Mutex<Vec<String>>>,
) -> impl FnMut(cpal::StreamError) + Send + 'static {
    move |error| {
        if let Ok(mut errors) = error_log.lock() {
            errors.push(error.to_string());
        }
    }
}

fn push_f32_samples(input: &[f32], channels: usize, buffer: &Arc<Mutex<BoundedPcmBuffer>>) {
    push_downmixed_samples(input, channels, buffer, |sample| sample.clamp(-1.0, 1.0));
}

fn push_f64_samples(input: &[f64], channels: usize, buffer: &Arc<Mutex<BoundedPcmBuffer>>) {
    push_downmixed_samples(input, channels, buffer, |sample| {
        sample.clamp(-1.0, 1.0) as f32
    });
}

fn push_signed_samples<T>(
    input: &[T],
    max: f32,
    channels: usize,
    buffer: &Arc<Mutex<BoundedPcmBuffer>>,
) where
    T: Copy + IntoSampleF64,
{
    push_downmixed_samples(input, channels, buffer, |sample| {
        (sample.into_sample_f64() as f32 / max).clamp(-1.0, 1.0)
    });
}

fn push_unsigned_samples<T>(
    input: &[T],
    max: f32,
    channels: usize,
    buffer: &Arc<Mutex<BoundedPcmBuffer>>,
) where
    T: Copy + IntoSampleF64,
{
    push_downmixed_samples(input, channels, buffer, |sample| {
        (((sample.into_sample_f64() as f32 / max) * 2.0) - 1.0).clamp(-1.0, 1.0)
    });
}

fn push_downmixed_samples<T, F>(
    input: &[T],
    channels: usize,
    buffer: &Arc<Mutex<BoundedPcmBuffer>>,
    convert: F,
) where
    T: Copy,
    F: Fn(T) -> f32,
{
    if input.is_empty() {
        return;
    }
    let channels = channels.max(1);
    let mut mono = Vec::with_capacity(input.len() / channels + 1);
    for frame in input.chunks(channels) {
        let mut sum = 0.0_f32;
        for sample in frame {
            sum += convert(*sample);
        }
        mono.push(sum / frame.len() as f32);
    }
    if let Ok(mut guard) = buffer.lock() {
        guard.push(&mono);
    }
}

trait IntoSampleF64 {
    fn into_sample_f64(self) -> f64;
}

macro_rules! impl_into_sample_f64 {
    ($($kind:ty),+ $(,)?) => {
        $(
            impl IntoSampleF64 for $kind {
                fn into_sample_f64(self) -> f64 {
                    self as f64
                }
            }
        )+
    };
}

impl_into_sample_f64!(i8, i16, i32, i64, u8, u16, u32, u64);

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use crate::audio::activity::BoundedPcmBuffer;
    use crate::audio::capture::{
        mix_mono_sources, push_f32_samples, push_signed_samples, push_unsigned_samples,
    };

    #[test]
    fn downmixes_interleaved_float_samples() {
        let buffer = Arc::new(Mutex::new(BoundedPcmBuffer::new(8)));
        push_f32_samples(&[1.0, -1.0, 0.5, 0.25], 2, &buffer);
        let guard = buffer.lock().expect("buffer should lock");

        assert_eq!(guard.samples(), &[0.0, 0.375]);
    }

    #[test]
    fn converts_signed_and_unsigned_samples() {
        let signed = Arc::new(Mutex::new(BoundedPcmBuffer::new(8)));
        push_signed_samples(&[i16::MAX, 0, -i16::MAX], i16::MAX as f32, 1, &signed);
        let unsigned = Arc::new(Mutex::new(BoundedPcmBuffer::new(8)));
        push_unsigned_samples(&[0_u8, 128, u8::MAX], u8::MAX as f32, 1, &unsigned);

        let signed = signed.lock().expect("signed buffer should lock");
        let unsigned = unsigned.lock().expect("unsigned buffer should lock");
        assert_eq!(signed.samples(), &[1.0, 0.0, -1.0]);
        assert!(unsigned.samples()[0] <= -0.99);
        assert!(unsigned.samples()[1].abs() < 0.01);
        assert!(unsigned.samples()[2] >= 0.99);
    }

    #[test]
    fn mixed_audio_resamples_before_combining() {
        let mixed = mix_mono_sources(&[1.0, 1.0, 1.0, 1.0], 4, &[0.0, 0.0], 2, 2);

        assert_eq!(mixed, vec![0.5, 0.5]);
    }
}
