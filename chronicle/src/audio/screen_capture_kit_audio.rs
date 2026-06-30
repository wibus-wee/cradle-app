//! macOS ScreenCaptureKit system audio capture.

use std::mem;
use std::ptr;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchQueueAttr};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{AnyThread, DefinedClass, define_class, msg_send};
use objc2_core_audio_types::{
    AudioBufferList, AudioStreamBasicDescription, kAudioFormatFlagIsFloat,
    kAudioFormatFlagIsNonInterleaved, kAudioFormatFlagIsSignedInteger, kAudioFormatLinearPCM,
};
use objc2_core_media::{CMBlockBuffer, CMSampleBuffer};
use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol};
use objc2_screen_capture_kit::{
    SCContentFilter, SCShareableContent, SCStream, SCStreamConfiguration, SCStreamOutput,
    SCStreamOutputType,
};

use crate::audio::activity::BoundedPcmBuffer;
use crate::audio::capture::MicrophoneCaptureReport;
use crate::error::{ChronicleError, ChronicleResult};

const SCREEN_CAPTURE_SAMPLE_RATE: u32 = 48_000;
const SCREEN_CAPTURE_CHANNELS: u16 = 2;

#[derive(Clone)]
struct AudioOutputIvars {
    buffer: Arc<Mutex<BoundedPcmBuffer>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "CradleScreenCaptureKitAudioOutput"]
    #[ivars = AudioOutputIvars]
    struct AudioOutput;

    unsafe impl NSObjectProtocol for AudioOutput {}

    unsafe impl SCStreamOutput for AudioOutput {
        #[allow(non_snake_case)]
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        unsafe fn stream_didOutputSampleBuffer_ofType(
            &self,
            _stream: &SCStream,
            sample_buffer: &CMSampleBuffer,
            output_type: SCStreamOutputType,
        ) {
            if output_type != SCStreamOutputType::Audio {
                return;
            }
            if let Some(samples) = read_mono_samples(sample_buffer)
                && let Ok(mut buffer) = self.ivars().buffer.lock()
            {
                buffer.push(&samples);
            }
        }
    }
);

impl AudioOutput {
    fn new(buffer: Arc<Mutex<BoundedPcmBuffer>>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(AudioOutputIvars { buffer });
        unsafe { msg_send![super(this), init] }
    }
}

pub fn capture_system_audio_samples(duration_ms: u64) -> ChronicleResult<MicrophoneCaptureReport> {
    let duration_ms = duration_ms.clamp(100, 30_000);
    let max_samples = ((SCREEN_CAPTURE_SAMPLE_RATE as usize * duration_ms as usize) / 1000)
        .saturating_add(SCREEN_CAPTURE_SAMPLE_RATE as usize);
    let buffer = Arc::new(Mutex::new(BoundedPcmBuffer::new(max_samples)));
    let content = request_shareable_content()?;
    let displays = unsafe { content.displays() };
    let display = if displays.is_empty() {
        return Err(ChronicleError::Process(
            "ScreenCaptureKit did not return a shareable display".to_string(),
        ));
    } else {
        displays.objectAtIndex(0)
    };
    let excluded_windows = NSArray::from_slice(&[] as &[&objc2_screen_capture_kit::SCWindow]);
    let filter = unsafe {
        SCContentFilter::initWithDisplay_excludingWindows(
            SCContentFilter::alloc(),
            &display,
            &excluded_windows,
        )
    };
    let configuration = unsafe { SCStreamConfiguration::new() };
    unsafe {
        configuration.setWidth(2);
        configuration.setHeight(2);
        configuration.setQueueDepth(3);
        configuration.setCapturesAudio(true);
        configuration.setCaptureMicrophone(false);
        configuration.setSampleRate(SCREEN_CAPTURE_SAMPLE_RATE as isize);
        configuration.setChannelCount(SCREEN_CAPTURE_CHANNELS as isize);
        configuration.setExcludesCurrentProcessAudio(false);
    }

    let output = AudioOutput::new(Arc::clone(&buffer));
    let output_protocol: &ProtocolObject<dyn SCStreamOutput> = ProtocolObject::from_ref(&*output);
    let stream = unsafe {
        SCStream::initWithFilter_configuration_delegate(
            SCStream::alloc(),
            &filter,
            &configuration,
            None,
        )
    };
    let queue = DispatchQueue::new(
        "dev.cradle.chronicle.screencapturekit.audio",
        DispatchQueueAttr::SERIAL,
    );
    unsafe {
        stream
            .addStreamOutput_type_sampleHandlerQueue_error(
                output_protocol,
                SCStreamOutputType::Audio,
                Some(&queue),
            )
            .map_err(|error| {
                ChronicleError::Process(format!(
                    "failed to attach ScreenCaptureKit audio output: {}",
                    ns_error_message(&error)
                ))
            })?;
    }

    start_capture(&stream)?;
    thread::sleep(Duration::from_millis(duration_ms));
    let stop_result = stop_capture(&stream);
    let remove_result =
        unsafe { stream.removeStreamOutput_type_error(output_protocol, SCStreamOutputType::Audio) };
    stop_result?;
    if let Err(error) = remove_result {
        return Err(ChronicleError::Process(format!(
            "failed to detach ScreenCaptureKit audio output: {}",
            ns_error_message(&error)
        )));
    }

    let buffer = buffer.lock().map_err(|_| {
        ChronicleError::Process("ScreenCaptureKit audio buffer lock poisoned".to_string())
    })?;

    Ok(MicrophoneCaptureReport {
        device_name: "ScreenCaptureKit system audio".to_string(),
        sample_rate: SCREEN_CAPTURE_SAMPLE_RATE,
        channels: 1,
        source_sample_format: "screencapturekit:f32:mono".to_string(),
        duration_ms,
        samples: buffer.samples().to_vec(),
        dropped_samples: buffer.dropped_samples(),
    })
}

fn request_shareable_content() -> ChronicleResult<Retained<SCShareableContent>> {
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            let result = if !error.is_null() {
                let error = unsafe { Retained::retain(error) };
                Err(error
                    .map(|error| ns_error_message(&error))
                    .unwrap_or_else(|| "unknown ScreenCaptureKit content error".to_string()))
            } else {
                unsafe { Retained::retain(content) }
                    .ok_or_else(|| "ScreenCaptureKit returned empty shareable content".to_string())
            };
            let _ = tx.send(result);
        },
    );
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            true,
            true,
            &block,
        );
    }
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| {
            ChronicleError::Process("timed out waiting for ScreenCaptureKit content".to_string())
        })?
        .map_err(|message| {
            ChronicleError::Process(format!("ScreenCaptureKit content unavailable: {message}"))
        })
}

fn start_capture(stream: &SCStream) -> ChronicleResult<()> {
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(move |error: *mut NSError| {
        let result = if error.is_null() {
            Ok(())
        } else {
            let error = unsafe { Retained::retain(error) };
            Err(error
                .map(|error| ns_error_message(&error))
                .unwrap_or_else(|| "unknown ScreenCaptureKit start error".to_string()))
        };
        let _ = tx.send(result);
    });
    unsafe {
        stream.startCaptureWithCompletionHandler(Some(&block));
    }
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| {
            ChronicleError::Process("timed out starting ScreenCaptureKit audio capture".to_string())
        })?
        .map_err(|message| {
            ChronicleError::Process(format!(
                "failed to start ScreenCaptureKit audio capture: {message}"
            ))
        })
}

fn stop_capture(stream: &SCStream) -> ChronicleResult<()> {
    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(move |error: *mut NSError| {
        let result = if error.is_null() {
            Ok(())
        } else {
            let error = unsafe { Retained::retain(error) };
            Err(error
                .map(|error| ns_error_message(&error))
                .unwrap_or_else(|| "unknown ScreenCaptureKit stop error".to_string()))
        };
        let _ = tx.send(result);
    });
    unsafe {
        stream.stopCaptureWithCompletionHandler(Some(&block));
    }
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| {
            ChronicleError::Process("timed out stopping ScreenCaptureKit audio capture".to_string())
        })?
        .map_err(|message| {
            ChronicleError::Process(format!(
                "failed to stop ScreenCaptureKit audio capture: {message}"
            ))
        })
}

fn ns_error_message(error: &NSError) -> String {
    error.localizedDescription().to_string()
}

fn read_mono_samples(sample_buffer: &CMSampleBuffer) -> Option<Vec<f32>> {
    if unsafe { !sample_buffer.is_valid() } || unsafe { !sample_buffer.data_is_ready() } {
        return None;
    }
    let format = unsafe { sample_buffer.format_description()? };
    let description =
        unsafe { objc2_core_media::CMAudioFormatDescriptionGetStreamBasicDescription(&format) };
    if description.is_null() {
        return None;
    }
    let description = unsafe { *description };
    if description.mFormatID != kAudioFormatLinearPCM {
        return None;
    }
    let samples_per_channel = unsafe { sample_buffer.num_samples() };
    if samples_per_channel <= 0 {
        return None;
    }

    let mut list_size = 0_usize;
    let size_status = unsafe {
        sample_buffer.audio_buffer_list_with_retained_block_buffer(
            &mut list_size,
            ptr::null_mut(),
            0,
            None,
            None,
            objc2_core_media::kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            ptr::null_mut(),
        )
    };
    if size_status != 0 || list_size == 0 {
        return None;
    }
    let mut storage = vec![0_u8; list_size];
    let list_ptr = storage.as_mut_ptr().cast::<AudioBufferList>();
    let mut block_buffer: *mut CMBlockBuffer = ptr::null_mut();
    let status = unsafe {
        sample_buffer.audio_buffer_list_with_retained_block_buffer(
            ptr::null_mut(),
            list_ptr,
            list_size,
            None,
            None,
            objc2_core_media::kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            &mut block_buffer,
        )
    };
    if status != 0 {
        return None;
    }
    let _retained_block = unsafe { Retained::retain(block_buffer) };
    let list = unsafe { &*list_ptr };
    let channels = description.mChannelsPerFrame.max(1) as usize;
    let frame_count = samples_per_channel as usize;
    let flags = description.mFormatFlags;
    let non_interleaved = flags & kAudioFormatFlagIsNonInterleaved != 0;
    let mut mono = vec![0.0_f32; frame_count];
    let buffer_count = list.mNumberBuffers as usize;

    for buffer_index in 0..buffer_count {
        let audio_buffer = unsafe { &*list.mBuffers.as_ptr().add(buffer_index) };
        if audio_buffer.mData.is_null() || audio_buffer.mDataByteSize == 0 {
            continue;
        }
        let bytes = unsafe {
            std::slice::from_raw_parts(
                audio_buffer.mData.cast::<u8>(),
                audio_buffer.mDataByteSize as usize,
            )
        };
        let buffer_channels = audio_buffer.mNumberChannels.max(1) as usize;
        append_audio_buffer_to_mono(
            bytes,
            &description,
            buffer_channels,
            non_interleaved,
            buffer_index,
            channels,
            &mut mono,
        );
    }

    if non_interleaved {
        let divisor = buffer_count.max(1) as f32;
        for sample in &mut mono {
            *sample = (*sample / divisor).clamp(-1.0, 1.0);
        }
    }
    Some(mono)
}

fn append_audio_buffer_to_mono(
    bytes: &[u8],
    description: &AudioStreamBasicDescription,
    buffer_channels: usize,
    non_interleaved: bool,
    buffer_index: usize,
    total_channels: usize,
    mono: &mut [f32],
) {
    let bits_per_channel = description.mBitsPerChannel;
    let sample_bytes = (bits_per_channel / 8) as usize;
    if sample_bytes == 0 {
        return;
    }
    let is_float = description.mFormatFlags & kAudioFormatFlagIsFloat != 0;
    let is_signed = description.mFormatFlags & kAudioFormatFlagIsSignedInteger != 0;
    let samples_in_buffer = bytes.len() / sample_bytes;
    if samples_in_buffer == 0 {
        return;
    }

    if non_interleaved {
        let frames = samples_in_buffer.min(mono.len());
        for (frame_index, sample) in mono.iter_mut().enumerate().take(frames) {
            let sample_offset = frame_index * sample_bytes;
            *sample += read_normalized_sample(
                &bytes[sample_offset..sample_offset + sample_bytes],
                bits_per_channel,
                is_float,
                is_signed,
            );
        }
        return;
    }

    let channels = buffer_channels.max(total_channels).max(1);
    let frames = (samples_in_buffer / channels).min(mono.len());
    for (frame_index, sample) in mono.iter_mut().enumerate().take(frames) {
        let mut sum = 0.0_f32;
        for channel_index in 0..channels {
            let sample_index = frame_index * channels + channel_index;
            let sample_offset = sample_index * sample_bytes;
            sum += read_normalized_sample(
                &bytes[sample_offset..sample_offset + sample_bytes],
                bits_per_channel,
                is_float,
                is_signed,
            );
        }
        *sample += (sum / channels as f32).clamp(-1.0, 1.0);
    }
    let _ = buffer_index;
}

fn read_normalized_sample(
    bytes: &[u8],
    bits_per_channel: u32,
    is_float: bool,
    is_signed: bool,
) -> f32 {
    if is_float {
        return match bits_per_channel {
            32 if bytes.len() >= mem::size_of::<f32>() => {
                f32::from_ne_bytes(bytes[0..4].try_into().unwrap()).clamp(-1.0, 1.0)
            }
            64 if bytes.len() >= mem::size_of::<f64>() => {
                (f64::from_ne_bytes(bytes[0..8].try_into().unwrap()) as f32).clamp(-1.0, 1.0)
            }
            _ => 0.0,
        };
    }
    match (bits_per_channel, is_signed) {
        (16, true) if bytes.len() >= 2 => {
            i16::from_ne_bytes(bytes[0..2].try_into().unwrap()) as f32 / i16::MAX as f32
        }
        (24, true) if bytes.len() >= 3 => {
            let value = i32::from_ne_bytes([
                bytes[0],
                bytes[1],
                bytes[2],
                if bytes[2] & 0x80 == 0 { 0 } else { 0xff },
            ]);
            value as f32 / 8_388_607.0
        }
        (32, true) if bytes.len() >= 4 => {
            i32::from_ne_bytes(bytes[0..4].try_into().unwrap()) as f32 / i32::MAX as f32
        }
        (16, false) if bytes.len() >= 2 => {
            (u16::from_ne_bytes(bytes[0..2].try_into().unwrap()) as f32 / u16::MAX as f32) * 2.0
                - 1.0
        }
        (32, false) if bytes.len() >= 4 => {
            (u32::from_ne_bytes(bytes[0..4].try_into().unwrap()) as f32 / u32::MAX as f32) * 2.0
                - 1.0
        }
        _ => 0.0,
    }
    .clamp(-1.0, 1.0)
}
