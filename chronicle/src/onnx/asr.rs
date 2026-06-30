//! SenseVoice ASR (Automatic Speech Recognition) ONNX inference.
//!
//! Implements speech recognition using SenseVoice.
//!
//! When the `sherpa-asr` feature is enabled, ASR delegates preprocessing and
//! decoding to sherpa-onnx. The default build uses direct ONNX inference so the
//! crate remains buildable without downloading sherpa-onnx native archives.

use std::path::Path;
#[cfg(not(feature = "sherpa-asr"))]
use std::{f32::consts::PI, fs};

#[cfg(not(feature = "sherpa-asr"))]
use ndarray::Array1;
#[cfg(not(feature = "sherpa-asr"))]
use ndarray::{Array2, s};
#[cfg(not(feature = "sherpa-asr"))]
use ort::session::Session;
#[cfg(not(feature = "sherpa-asr"))]
use ort::value::Tensor;
#[cfg(feature = "sherpa-asr")]
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig};

use crate::error::{ChronicleError, ChronicleResult};

// ---------------------------------------------------------------------------
// Fbank configuration
// ---------------------------------------------------------------------------

/// Window function type for STFT framing.
#[derive(Debug, Clone, Copy)]
pub enum WindowType {
    Hamming,
}

/// Configuration for log-mel filterbank feature extraction.
#[derive(Debug, Clone)]
pub struct FbankConfig {
    pub sample_rate: u32,
    pub num_mels: usize,
    pub frame_length_ms: f32,
    pub frame_shift_ms: f32,
    pub window: WindowType,
}

impl Default for FbankConfig {
    fn default() -> Self {
        Self {
            sample_rate: 16000,
            num_mels: 80,
            frame_length_ms: 25.0,
            frame_shift_ms: 10.0,
            window: WindowType::Hamming,
        }
    }
}

#[cfg(not(feature = "sherpa-asr"))]
impl FbankConfig {
    /// Frame length in samples.
    fn frame_length_samples(&self) -> usize {
        ((self.frame_length_ms / 1000.0) * self.sample_rate as f32) as usize
    }

    /// Frame shift (hop) in samples.
    fn frame_shift_samples(&self) -> usize {
        ((self.frame_shift_ms / 1000.0) * self.sample_rate as f32) as usize
    }

    /// FFT size — next power of two >= frame_length.
    fn fft_size(&self) -> usize {
        let n = self.frame_length_samples();
        n.next_power_of_two()
    }
}

// ---------------------------------------------------------------------------
// ASR result types
// ---------------------------------------------------------------------------

/// A single decoded token with confidence.
#[derive(Debug, Clone)]
pub struct TokenInfo {
    pub token: String,
    pub confidence: f32,
}

/// Result of transcription.
#[derive(Debug, Clone)]
pub struct AsrResult {
    pub text: String,
    pub language: Option<String>,
    pub tokens: Vec<TokenInfo>,
}

// ---------------------------------------------------------------------------
// SenseVoice ASR engine
// ---------------------------------------------------------------------------

/// SenseVoice ASR inference engine.
pub struct SenseVoiceAsr {
    #[cfg(feature = "sherpa-asr")]
    recognizer: OfflineRecognizer,
    #[cfg(not(feature = "sherpa-asr"))]
    session: Session,
    #[cfg(not(feature = "sherpa-asr"))]
    tokens: Vec<String>,
    #[cfg(not(feature = "sherpa-asr"))]
    fbank_config: FbankConfig,
}

impl SenseVoiceAsr {
    /// Create a new ASR engine from model and tokens paths.
    pub fn new(model_path: &Path, tokens_path: &Path) -> ChronicleResult<Self> {
        #[cfg(feature = "sherpa-asr")]
        {
            let mut config = OfflineRecognizerConfig::default();
            config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
                model: Some(model_path.to_string_lossy().to_string()),
                language: Some("auto".to_string()),
                use_itn: true,
            };
            config.model_config.tokens = Some(tokens_path.to_string_lossy().to_string());
            config.model_config.num_threads = 2;

            let recognizer = OfflineRecognizer::create(&config).ok_or_else(|| {
                ChronicleError::Process(format!(
                    "failed to create sherpa-onnx SenseVoice recognizer for {}",
                    model_path.display()
                ))
            })?;

            Ok(Self { recognizer })
        }

        #[cfg(not(feature = "sherpa-asr"))]
        {
            let session = super::load_session(model_path)?;
            let tokens = load_tokens(tokens_path)?;
            Ok(Self {
                session,
                tokens,
                fbank_config: FbankConfig::default(),
            })
        }
    }

    /// Transcribe raw audio samples (f32, expected 16kHz mono).
    ///
    /// If `sample_rate` differs from 16000, the caller should resample first.
    pub fn transcribe(&mut self, samples: &[f32], _sample_rate: u32) -> ChronicleResult<AsrResult> {
        if samples.is_empty() {
            return Ok(AsrResult {
                text: String::new(),
                language: None,
                tokens: Vec::new(),
            });
        }

        #[cfg(feature = "sherpa-asr")]
        {
            let stream = self.recognizer.create_stream();
            stream.accept_waveform(_sample_rate as i32, samples);
            self.recognizer.decode(&stream);
            let result = stream.get_result().ok_or_else(|| {
                ChronicleError::Process("sherpa-onnx SenseVoice returned no result".to_string())
            })?;

            Ok(AsrResult {
                text: result.text.trim().to_string(),
                language: None,
                tokens: result
                    .tokens
                    .into_iter()
                    .map(|token| TokenInfo {
                        token,
                        confidence: 1.0,
                    })
                    .collect(),
            })
        }

        #[cfg(not(feature = "sherpa-asr"))]
        {
            let features = extract_fbank_with_context(samples, &self.fbank_config)?;
            let num_frames = features.shape()[0] as i32;
            let speech = features.insert_axis(ndarray::Axis(0));

            let lengths = Array1::from_vec(vec![num_frames]);
            let language = Array1::from_vec(vec![sense_voice_control_value(
                "CRADLE_CHRONICLE_SENSEVOICE_LANGUAGE",
                0,
            )]);
            let text_norm = Array1::from_vec(vec![sense_voice_control_value(
                "CRADLE_CHRONICLE_SENSEVOICE_TEXT_NORM",
                15,
            )]);

            let speech_tensor = Tensor::from_array(speech)
                .map_err(|error| ChronicleError::Process(format!("speech tensor: {error}")))?;
            let lengths_tensor = Tensor::from_array(lengths)
                .map_err(|error| ChronicleError::Process(format!("lengths tensor: {error}")))?;
            let language_tensor = Tensor::from_array(language)
                .map_err(|error| ChronicleError::Process(format!("language tensor: {error}")))?;
            let text_norm_tensor = Tensor::from_array(text_norm)
                .map_err(|error| ChronicleError::Process(format!("text norm tensor: {error}")))?;

            let outputs = self
                .session
                .run(ort::inputs![
                    "x" => speech_tensor,
                    "x_length" => lengths_tensor,
                    "language" => language_tensor,
                    "text_norm" => text_norm_tensor,
                ])
                .map_err(|error| ChronicleError::Process(format!("ONNX run failed: {error}")))?;

            let (shape, logits_data) = outputs["logits"]
                .try_extract_tensor::<f32>()
                .map_err(|error| ChronicleError::Process(format!("extract logits: {error}")))?;

            let seq_len = shape[1] as usize;
            let vocab_size = shape[2] as usize;
            let logits = Array2::from_shape_vec(
                (seq_len, vocab_size),
                logits_data[..seq_len * vocab_size].to_vec(),
            )
            .map_err(|error| ChronicleError::Process(format!("logits reshape: {error}")))?;

            Ok(greedy_decode(&logits.to_owned(), &self.tokens))
        }
    }
}

#[cfg(not(feature = "sherpa-asr"))]
fn sense_voice_control_value(env_name: &str, default_value: i32) -> i32 {
    std::env::var(env_name)
        .ok()
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(default_value)
}

// ---------------------------------------------------------------------------
// Tokens loading
// ---------------------------------------------------------------------------

/// Load tokens.txt vocabulary file.
/// Format: each line is "token_id<space_or_tab>token_string" or "token_string<space_or_tab>token_id"
#[cfg(not(feature = "sherpa-asr"))]
fn load_tokens(path: &Path) -> ChronicleResult<Vec<String>> {
    let content =
        fs::read_to_string(path).map_err(|e| ChronicleError::io_at(path.to_path_buf(), e))?;

    let mut max_id: usize = 0;
    let mut entries: Vec<(usize, String)> = Vec::new();

    let raw_lines: Vec<&str> = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let token_id_format = raw_lines.iter().take(32).enumerate().all(|(index, line)| {
        let mut parts = line.split_whitespace();
        let _token = parts.next();
        parts
            .next()
            .and_then(|value| value.parse::<usize>().ok())
            .is_some_and(|id| id == index)
    });

    for line in raw_lines {
        let line = line.trim();
        // Split on first whitespace
        let mut parts = line.splitn(2, [' ', '\t']);
        let first = parts.next().unwrap_or("");
        let second = parts.next().unwrap_or("");

        // Determine which is the id and which is the token
        let (id, token) = if token_id_format {
            let id = second.parse::<usize>().map_err(|error| {
                ChronicleError::Process(format!("invalid token id in tokens file: {error}"))
            })?;
            (id, first.to_string())
        } else if let Ok(id) = first.parse::<usize>() {
            // "id token" format
            (id, second.to_string())
        } else if let Ok(id) = second.parse::<usize>() {
            // "token id" format
            (id, first.to_string())
        } else {
            // Fallback: use line index as id, whole line as token
            (entries.len(), line.to_string())
        };

        if id > max_id {
            max_id = id;
        }
        entries.push((id, token));
    }

    let mut tokens = vec![String::new(); max_id + 1];
    for (id, token) in entries {
        if id < tokens.len() {
            tokens[id] = token;
        }
    }

    Ok(tokens)
}

// ---------------------------------------------------------------------------
// Greedy decoding
// ---------------------------------------------------------------------------

/// Special tokens to skip during decoding.
#[cfg(not(feature = "sherpa-asr"))]
const SKIP_TOKENS: &[&str] = &[
    "<blank>",
    "<sos>",
    "<eos>",
    "<pad>",
    "<unk>",
    "<s>",
    "</s>",
    "<ctc_blank>",
    "⁇",
    // SenseVoice language/event tokens
    "<|zh|>",
    "<|en|>",
    "<|ja|>",
    "<|ko|>",
    "<|yue|>",
    "<|HAPPY|>",
    "<|SAD|>",
    "<|ANGRY|>",
    "<|NEUTRAL|>",
    "<|BGM|>",
    "<|Speech|>",
    "<|Applause|>",
    "<|Laughter|>",
    "<|NOISE|>",
    "<|nospeech|>",
    "<|startoftext|>",
    "<|endoftext|>",
    "<|beginoftext|>",
];

/// Language detection tokens.
#[cfg(not(feature = "sherpa-asr"))]
const LANGUAGE_TOKENS: &[&str] = &["<|zh|>", "<|en|>", "<|ja|>", "<|ko|>", "<|yue|>"];

/// Greedy argmax decoding over logits.
#[cfg(not(feature = "sherpa-asr"))]
fn greedy_decode(logits: &Array2<f32>, tokens: &[String]) -> AsrResult {
    let seq_len = logits.shape()[0];
    let mut decoded_tokens: Vec<TokenInfo> = Vec::new();
    let mut detected_language: Option<String> = None;

    for t in 0..seq_len {
        let row = logits.slice(s![t, ..]);
        // Argmax
        let (best_id, best_logit) = row
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or((0, &0.0));

        // Softmax-approx confidence
        let confidence = compute_confidence(&row.to_vec(), *best_logit);

        if best_id >= tokens.len() {
            continue;
        }

        let token_str = &tokens[best_id];

        // Detect language from special token
        if detected_language.is_none() {
            for &lang_tok in LANGUAGE_TOKENS {
                if token_str == lang_tok {
                    detected_language = Some(
                        lang_tok
                            .trim_start_matches("<|")
                            .trim_end_matches("|>")
                            .to_string(),
                    );
                }
            }
        }

        // Skip special tokens
        if should_skip_token(token_str) {
            continue;
        }

        decoded_tokens.push(TokenInfo {
            token: token_str.clone(),
            confidence,
        });
    }

    // Join tokens — handle BPE sentencepiece style (▁ = space)
    let text = join_tokens(&decoded_tokens);

    AsrResult {
        text,
        language: detected_language,
        tokens: decoded_tokens,
    }
}

/// Check if a token should be skipped.
#[cfg(not(feature = "sherpa-asr"))]
fn should_skip_token(token: &str) -> bool {
    if token.is_empty() {
        return true;
    }
    for &skip in SKIP_TOKENS {
        if token == skip {
            return true;
        }
    }
    // Skip any token that looks like <|...|>
    if token.starts_with("<|") && token.ends_with("|>") {
        return true;
    }
    false
}

/// Compute approximate confidence from logits via softmax on the argmax.
#[cfg(not(feature = "sherpa-asr"))]
fn compute_confidence(logits: &[f32], max_logit: f32) -> f32 {
    let sum_exp: f64 = logits.iter().map(|&x| ((x - max_logit) as f64).exp()).sum();
    (1.0 / sum_exp as f32).clamp(0.0, 1.0)
}

/// Join tokens handling sentencepiece ▁ (U+2581) as word boundaries.
#[cfg(not(feature = "sherpa-asr"))]
fn join_tokens(tokens: &[TokenInfo]) -> String {
    let mut result = String::new();
    for tok in tokens {
        let t = &tok.token;
        if t.starts_with('\u{2581}') {
            if !result.is_empty() {
                result.push(' ');
            }
            result.push_str(&t['\u{2581}'.len_utf8()..]);
        } else {
            result.push_str(t);
        }
    }
    result.trim().to_string()
}

// ---------------------------------------------------------------------------
// Fbank feature extraction
// ---------------------------------------------------------------------------

/// Extract fbank features and stack with context frames (×7 → 560 dim).
#[cfg(not(feature = "sherpa-asr"))]
fn extract_fbank_with_context(
    samples: &[f32],
    config: &FbankConfig,
) -> ChronicleResult<Array2<f32>> {
    let fbank = extract_fbank(samples, config)?;
    let num_frames = fbank.shape()[0];
    let num_mels = fbank.shape()[1];

    // SenseVoice uses LFR: lfr_m=7 context frames, lfr_n=6 subsampling stride
    let lfr_m = 7usize;
    let lfr_n = 6usize;

    let output_frames = num_frames.div_ceil(lfr_n);
    let feat_dim = num_mels * lfr_m; // 80 * 7 = 560

    let mut output = Array2::<f32>::zeros((output_frames, feat_dim));

    for i in 0..output_frames {
        let center = i * lfr_n;
        for j in 0..lfr_m {
            let frame_idx = (center + j).min(num_frames - 1);
            let src = fbank.slice(s![frame_idx, ..]);
            output
                .slice_mut(s![i, j * num_mels..(j + 1) * num_mels])
                .assign(&src);
        }
    }

    Ok(output)
}

/// Extract 80-dim log-mel filterbank features from raw audio.
#[cfg(not(feature = "sherpa-asr"))]
pub fn extract_fbank(samples: &[f32], config: &FbankConfig) -> ChronicleResult<Array2<f32>> {
    let frame_len = config.frame_length_samples();
    let frame_shift = config.frame_shift_samples();
    let fft_size = config.fft_size();
    let num_mels = config.num_mels;

    if samples.len() < frame_len {
        return Err(ChronicleError::InvalidArgument(
            "audio too short for a single frame".into(),
        ));
    }

    // Pre-emphasis
    let mut emphasized = Vec::with_capacity(samples.len());
    emphasized.push(samples[0]);
    for i in 1..samples.len() {
        emphasized.push(samples[i] - 0.97 * samples[i - 1]);
    }

    // Hamming window
    let window = hamming_window(frame_len);

    // Mel filterbank weights [num_mels × (fft_size/2 + 1)]
    let mel_filters = mel_filterbank(num_mels, fft_size, config.sample_rate);

    // Framing and processing
    let num_frames = (emphasized.len() - frame_len) / frame_shift + 1;
    let num_bins = fft_size / 2 + 1;
    let mut features = Array2::<f32>::zeros((num_frames, num_mels));

    let mut frame_buf = vec![0.0f32; fft_size];
    let mut spectrum_real = vec![0.0f32; fft_size];
    let mut spectrum_imag = vec![0.0f32; fft_size];

    for i in 0..num_frames {
        let start = i * frame_shift;

        // Apply window and zero-pad to fft_size
        for k in 0..fft_size {
            if k < frame_len {
                frame_buf[k] = emphasized[start + k] * window[k];
            } else {
                frame_buf[k] = 0.0;
            }
        }

        // FFT
        fft_radix2(&frame_buf, &mut spectrum_real, &mut spectrum_imag);

        // Power spectrum
        let mut power_spectrum = vec![0.0f32; num_bins];
        for k in 0..num_bins {
            power_spectrum[k] =
                spectrum_real[k] * spectrum_real[k] + spectrum_imag[k] * spectrum_imag[k];
        }

        // Apply mel filterbank and log
        for m in 0..num_mels {
            let mut energy: f32 = 0.0;
            for k in 0..num_bins {
                energy += mel_filters[m * num_bins + k] * power_spectrum[k];
            }
            features[[i, m]] = (energy.max(1e-10)).ln();
        }
    }

    // Cepstral mean and variance normalization
    apply_cmvn(&mut features);

    Ok(features)
}

/// Apply cepstral mean and variance normalization per feature dimension.
#[cfg(not(feature = "sherpa-asr"))]
fn apply_cmvn(features: &mut Array2<f32>) {
    let num_frames = features.shape()[0];
    if num_frames == 0 {
        return;
    }
    let num_mels = features.shape()[1];

    for m in 0..num_mels {
        let col = features.slice(s![.., m]);
        let mean = col.mean().unwrap_or(0.0);
        let variance: f32 =
            col.iter().map(|&x| (x - mean) * (x - mean)).sum::<f32>() / num_frames as f32;
        let std_dev = variance.sqrt().max(1e-10);

        for i in 0..num_frames {
            features[[i, m]] = (features[[i, m]] - mean) / std_dev;
        }
    }
}

/// Generate a Hamming window of given length.
#[cfg(not(feature = "sherpa-asr"))]
fn hamming_window(length: usize) -> Vec<f32> {
    (0..length)
        .map(|n| 0.54 - 0.46 * (2.0 * PI * n as f32 / (length as f32 - 1.0)).cos())
        .collect()
}

/// Convert frequency in Hz to mel scale.
#[cfg(not(feature = "sherpa-asr"))]
fn hz_to_mel(hz: f32) -> f32 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

/// Convert mel scale to Hz.
#[cfg(not(feature = "sherpa-asr"))]
fn mel_to_hz(mel: f32) -> f32 {
    700.0 * (10.0f32.powf(mel / 2595.0) - 1.0)
}

/// Compute mel filterbank matrix as flat vec [num_mels × num_bins].
#[cfg(not(feature = "sherpa-asr"))]
fn mel_filterbank(num_mels: usize, fft_size: usize, sample_rate: u32) -> Vec<f32> {
    let num_bins = fft_size / 2 + 1;
    let high_freq = sample_rate as f32 / 2.0;

    let low_mel = hz_to_mel(0.0);
    let high_mel = hz_to_mel(high_freq);

    let num_points = num_mels + 2;
    let mel_points: Vec<f32> = (0..num_points)
        .map(|i| low_mel + (high_mel - low_mel) * i as f32 / (num_points - 1) as f32)
        .collect();

    let bin_points: Vec<f32> = mel_points
        .iter()
        .map(|&m| mel_to_hz(m) * fft_size as f32 / sample_rate as f32)
        .collect();

    let mut filters = vec![0.0f32; num_mels * num_bins];

    for m in 0..num_mels {
        let left = bin_points[m];
        let center = bin_points[m + 1];
        let right = bin_points[m + 2];

        for k in 0..num_bins {
            let kf = k as f32;
            let weight = if kf >= left && kf <= center {
                if (center - left).abs() < 1e-10 {
                    0.0
                } else {
                    (kf - left) / (center - left)
                }
            } else if kf > center && kf <= right {
                if (right - center).abs() < 1e-10 {
                    0.0
                } else {
                    (right - kf) / (right - center)
                }
            } else {
                0.0
            };
            filters[m * num_bins + k] = weight;
        }
    }

    filters
}

// ---------------------------------------------------------------------------
// Pure-Rust Radix-2 FFT (Cooley-Tukey, decimation-in-time)
// ---------------------------------------------------------------------------

/// In-place radix-2 FFT. Input length must be a power of 2.
#[cfg(not(feature = "sherpa-asr"))]
fn fft_radix2(input: &[f32], real_out: &mut [f32], imag_out: &mut [f32]) {
    let n = input.len();
    debug_assert!(n.is_power_of_two(), "FFT size must be power of two");

    for i in 0..n {
        real_out[i] = input[i];
        imag_out[i] = 0.0;
    }

    // Bit-reversal permutation
    let bits = n.trailing_zeros();
    for i in 0..n {
        let j = bit_reverse(i as u32, bits) as usize;
        if i < j {
            real_out.swap(i, j);
            imag_out.swap(i, j);
        }
    }

    // Cooley-Tukey butterfly
    let mut size = 2;
    while size <= n {
        let half = size / 2;
        let angle_step = -2.0 * PI / size as f32;

        for start in (0..n).step_by(size) {
            for k in 0..half {
                let angle = angle_step * k as f32;
                let wr = angle.cos();
                let wi = angle.sin();

                let even = start + k;
                let odd = start + k + half;

                let tr = wr * real_out[odd] - wi * imag_out[odd];
                let ti = wr * imag_out[odd] + wi * real_out[odd];

                real_out[odd] = real_out[even] - tr;
                imag_out[odd] = imag_out[even] - ti;
                real_out[even] += tr;
                imag_out[even] += ti;
            }
        }

        size *= 2;
    }
}

/// Reverse bits of a value for FFT bit-reversal permutation.
#[cfg(not(feature = "sherpa-asr"))]
fn bit_reverse(mut x: u32, num_bits: u32) -> u32 {
    let mut result: u32 = 0;
    for _ in 0..num_bits {
        result = (result << 1) | (x & 1);
        x >>= 1;
    }
    result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    #[cfg(not(feature = "sherpa-asr"))]
    use super::*;
    #[cfg(not(feature = "sherpa-asr"))]
    use std::fs;
    #[cfg(not(feature = "sherpa-asr"))]
    use std::io::Write;

    /// Helper to write content to a temp file and return its path.
    #[cfg(not(feature = "sherpa-asr"))]
    fn write_temp_file(name: &str, content: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("chronicle_asr_tests");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_load_tokens_id_first() {
        let content = "0 <blank>\n1 hello\n2 world\n3 ▁the\n";
        let path = write_temp_file("tokens_id_first.txt", content);

        let tokens = load_tokens(&path).unwrap();
        assert_eq!(tokens[0], "<blank>");
        assert_eq!(tokens[1], "hello");
        assert_eq!(tokens[2], "world");
        assert_eq!(tokens[3], "▁the");
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_load_tokens_token_first() {
        let content = "<blank> 0\nhello 1\nworld 2\n";
        let path = write_temp_file("tokens_tok_first.txt", content);

        let tokens = load_tokens(&path).unwrap();
        assert_eq!(tokens[0], "<blank>");
        assert_eq!(tokens[1], "hello");
        assert_eq!(tokens[2], "world");
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_load_tokens_token_first_preserves_numeric_tokens() {
        let content = "<unk> 0\n<s> 1\n</s> 2\n0 3\n9690 4\n";
        let path = write_temp_file("tokens_numeric_token_first.txt", content);

        let tokens = load_tokens(&path).unwrap();
        assert_eq!(tokens[0], "<unk>");
        assert_eq!(tokens[3], "0");
        assert_eq!(tokens[4], "9690");
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_fbank_shape() {
        let samples = vec![0.01f32; 16000];
        let config = FbankConfig::default();

        let fbank = extract_fbank(&samples, &config).unwrap();
        let expected_frames = (16000 - 400) / 160 + 1;
        assert_eq!(fbank.shape()[0], expected_frames);
        assert_eq!(fbank.shape()[1], 80);
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_fbank_with_context_shape() {
        let samples: Vec<f32> = (0..16000).map(|i| (i as f32 * 0.01).sin() * 0.5).collect();
        let config = FbankConfig::default();

        let features = extract_fbank_with_context(&samples, &config).unwrap();
        assert_eq!(features.shape()[1], 560);
        let raw_frames = (16000 - 400) / 160 + 1; // 98
        let expected_output = (raw_frames + 5) / 6; // ceil(98/6) = 17
        assert_eq!(features.shape()[0], expected_output);
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_greedy_decode_basic() {
        let tokens = vec![
            "<blank>".to_string(),
            "▁hello".to_string(),
            "▁world".to_string(),
            "<eos>".to_string(),
        ];

        let mut logits = Array2::<f32>::zeros((3, 4));
        logits[[0, 1]] = 10.0;
        logits[[1, 2]] = 10.0;
        logits[[2, 3]] = 10.0;

        let result = greedy_decode(&logits, &tokens);
        assert_eq!(result.text, "hello world");
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_greedy_decode_skip_special() {
        let tokens = vec![
            "<blank>".to_string(),
            "<|zh|>".to_string(),
            "你".to_string(),
            "好".to_string(),
            "<eos>".to_string(),
        ];

        let mut logits = Array2::<f32>::zeros((4, 5));
        logits[[0, 1]] = 10.0;
        logits[[1, 2]] = 10.0;
        logits[[2, 3]] = 10.0;
        logits[[3, 4]] = 10.0;

        let result = greedy_decode(&logits, &tokens);
        assert_eq!(result.text, "你好");
        assert_eq!(result.language, Some("zh".to_string()));
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_fft_radix2_dc() {
        let n = 8;
        let input = vec![1.0f32; n];
        let mut real = vec![0.0f32; n];
        let mut imag = vec![0.0f32; n];

        fft_radix2(&input, &mut real, &mut imag);

        assert!((real[0] - 8.0).abs() < 1e-5);
        for i in 1..n {
            assert!(real[i].abs() < 1e-5, "bin {i} real: {}", real[i]);
            assert!(imag[i].abs() < 1e-5, "bin {i} imag: {}", imag[i]);
        }
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_fft_radix2_impulse() {
        let n = 8;
        let mut input = vec![0.0f32; n];
        input[0] = 1.0;
        let mut real = vec![0.0f32; n];
        let mut imag = vec![0.0f32; n];

        fft_radix2(&input, &mut real, &mut imag);

        for i in 0..n {
            assert!((real[i] - 1.0).abs() < 1e-5, "bin {i} real: {}", real[i]);
            assert!(imag[i].abs() < 1e-5, "bin {i} imag: {}", imag[i]);
        }
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_hamming_window() {
        let win = hamming_window(400);
        assert_eq!(win.len(), 400);
        assert!((win[0] - 0.08).abs() < 0.01);
        assert!((win[399] - 0.08).abs() < 0.01);
        assert!((win[199] - 1.0).abs() < 0.05);
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_mel_filterbank_shape() {
        let filters = mel_filterbank(80, 512, 16000);
        let num_bins = 512 / 2 + 1;
        assert_eq!(filters.len(), 80 * num_bins);

        for &w in &filters {
            assert!(w >= 0.0);
        }
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_join_tokens_sentencepiece() {
        let tokens = vec![
            TokenInfo {
                token: "▁Hello".into(),
                confidence: 0.9,
            },
            TokenInfo {
                token: "▁world".into(),
                confidence: 0.8,
            },
            TokenInfo {
                token: "!".into(),
                confidence: 0.7,
            },
        ];
        let text = join_tokens(&tokens);
        assert_eq!(text, "Hello world!");
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_confidence_computation() {
        let logits = vec![10.0, -5.0, -5.0, -5.0];
        let conf = compute_confidence(&logits, 10.0);
        assert!(conf > 0.9);

        let uniform = vec![0.0; 4];
        let conf_uniform = compute_confidence(&uniform, 0.0);
        assert!((conf_uniform - 0.25).abs() < 0.01);
    }

    #[cfg(not(feature = "sherpa-asr"))]
    #[test]
    fn test_audio_too_short() {
        let samples = vec![0.0f32; 100];
        let config = FbankConfig::default();
        let result = extract_fbank(&samples, &config);
        assert!(result.is_err());
    }
}
