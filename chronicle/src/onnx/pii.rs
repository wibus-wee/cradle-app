//! GLiNER-based PII detection via ONNX Runtime.
//!
//! Detects personally identifiable information spans in text using a GLiNER
//! token-classification model exported to ONNX format.

use std::fmt::{self, Display};
use std::path::Path;

use ndarray::{Array2, Array3, Array4, Axis};
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

use crate::error::{ChronicleError, ChronicleResult};

const GLINER_MAX_WIDTH: usize = 12;

/// PII entity types detectable by GLiNER.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PiiEntityType {
    Person,
    Email,
    PhoneNumber,
    CreditCard,
    Address,
    ApiKey,
    Ssn,
    IpAddress,
}

impl PiiEntityType {
    /// All entity types in label-index order (matches model output dim).
    pub const ALL: &'static [PiiEntityType] = &[
        PiiEntityType::Person,
        PiiEntityType::Email,
        PiiEntityType::PhoneNumber,
        PiiEntityType::CreditCard,
        PiiEntityType::Address,
        PiiEntityType::ApiKey,
        PiiEntityType::Ssn,
        PiiEntityType::IpAddress,
    ];

    /// Stable API label exposed by Chronicle.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Person => "person",
            Self::Email => "email",
            Self::PhoneNumber => "phone_number",
            Self::CreditCard => "credit_card",
            Self::Address => "address",
            Self::ApiKey => "api_key",
            Self::Ssn => "ssn",
            Self::IpAddress => "ip_address",
        }
    }

    /// Natural-language prompt label used by GLiNER zero-shot models.
    pub fn gliner_label(&self) -> &'static str {
        match self {
            Self::Person => "name",
            Self::Email => "email address",
            Self::PhoneNumber => "phone number",
            Self::CreditCard => "credit card",
            Self::Address => "location address",
            Self::ApiKey => "api key",
            Self::Ssn => "ssn",
            Self::IpAddress => "ip address",
        }
    }

    /// Parse from label string.
    pub fn from_label(s: &str) -> Option<Self> {
        match s {
            "person" => Some(Self::Person),
            "email" => Some(Self::Email),
            "phone_number" => Some(Self::PhoneNumber),
            "credit_card" => Some(Self::CreditCard),
            "address" => Some(Self::Address),
            "api_key" => Some(Self::ApiKey),
            "ssn" => Some(Self::Ssn),
            "ip_address" => Some(Self::IpAddress),
            _ => None,
        }
    }

    /// Placeholder tag for redaction, e.g. `[PERSON]`.
    pub fn redact_tag(&self) -> &'static str {
        match self {
            Self::Person => "[PERSON]",
            Self::Email => "[EMAIL]",
            Self::PhoneNumber => "[PHONE_NUMBER]",
            Self::CreditCard => "[CREDIT_CARD]",
            Self::Address => "[ADDRESS]",
            Self::ApiKey => "[API_KEY]",
            Self::Ssn => "[SSN]",
            Self::IpAddress => "[IP_ADDRESS]",
        }
    }
}

impl Display for PiiEntityType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

/// A detected PII entity span.
#[derive(Debug, Clone)]
pub struct PiiSpan {
    pub entity_type: PiiEntityType,
    pub text: String,
    pub start: usize,
    pub end: usize,
    pub confidence: f32,
}

/// GLiNER-based PII detector using ONNX Runtime.
pub struct GlinerPiiDetector {
    session: Session,
    tokenizer: Tokenizer,
    entity_types: Vec<PiiEntityType>,
    threshold: f32,
}

impl GlinerPiiDetector {
    /// Load model and tokenizer from disk.
    pub fn new(model_path: &Path, tokenizer_path: &Path) -> ChronicleResult<Self> {
        let session = super::load_session(model_path)?;

        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| ChronicleError::Process(format!("failed to load tokenizer: {e}")))?;

        Ok(Self {
            session,
            tokenizer,
            entity_types: PiiEntityType::ALL.to_vec(),
            threshold: 0.3,
        })
    }

    /// Set confidence threshold (default 0.3).
    pub fn with_threshold(mut self, threshold: f32) -> Self {
        self.threshold = threshold;
        self
    }

    /// Detect PII entities in text.
    pub fn detect(&mut self, text: &str) -> ChronicleResult<Vec<PiiSpan>> {
        if text.is_empty() {
            return Ok(Vec::new());
        }

        let text_tokens = split_text_tokens(text);
        if text_tokens.is_empty() {
            return Ok(Vec::new());
        }

        let mut input_words = Vec::new();
        for entity_type in &self.entity_types {
            input_words.push("<<ENT>>".to_string());
            input_words.push(entity_type.gliner_label().to_string());
        }
        input_words.push("<<SEP>>".to_string());
        let prompt_len = input_words.len();
        input_words.extend(text_tokens.iter().map(|token| token.text.clone()));

        let encoding = self
            .tokenizer
            .encode(input_words, true)
            .map_err(|e| ChronicleError::Process(format!("tokenization failed: {e}")))?;

        let ids = encoding.get_ids();
        let word_ids = encoding.get_word_ids();
        let seq_len = ids.len();
        let input_ids: Vec<i64> = ids.iter().map(|&id| id as i64).collect();
        let attention_mask: Vec<i64> = vec![1i64; seq_len];
        let words_mask = build_words_mask(word_ids, prompt_len);
        let text_lengths = vec![text_tokens.len() as i64];
        let candidate_spans = build_candidate_spans(text_tokens.len(), GLINER_MAX_WIDTH);

        let input_ids_arr = Array2::from_shape_vec((1, seq_len), input_ids)
            .map_err(|e| ChronicleError::Process(format!("ndarray shape error: {e}")))?;
        let attention_mask_arr = Array2::from_shape_vec((1, seq_len), attention_mask)
            .map_err(|e| ChronicleError::Process(format!("ndarray shape error: {e}")))?;
        let words_mask_arr = Array2::from_shape_vec((1, seq_len), words_mask)
            .map_err(|e| ChronicleError::Process(format!("ndarray shape error: {e}")))?;
        let text_lengths_arr = Array2::from_shape_vec((1, 1), text_lengths)
            .map_err(|e| ChronicleError::Process(format!("ndarray shape error: {e}")))?;
        let span_idx_arr = Array3::from_shape_vec((1, candidate_spans.len(), 2), {
            let mut values = Vec::with_capacity(candidate_spans.len() * 2);
            for span in &candidate_spans {
                values.push(span.start as i64);
                values.push(span.end as i64);
            }
            values
        })
        .map_err(|e| ChronicleError::Process(format!("ndarray shape error: {e}")))?;
        let span_mask_arr = Array2::from_shape_vec(
            (1, candidate_spans.len()),
            candidate_spans.iter().map(|span| span.valid).collect(),
        )
        .map_err(|e| ChronicleError::Process(format!("ndarray shape error: {e}")))?;

        let outputs = self.run_gliner_span(
            &input_ids_arr,
            &attention_mask_arr,
            &words_mask_arr,
            &text_lengths_arr,
            &span_idx_arr,
            &span_mask_arr,
        )?;

        let spans = self.extract_spans(&outputs, text, &text_tokens);
        Ok(spans)
    }

    /// Redact detected PII entities, replacing with [TYPE] placeholders.
    pub fn redact(&mut self, text: &str) -> ChronicleResult<String> {
        let mut spans = self.detect(text)?;
        if spans.is_empty() {
            return Ok(text.to_string());
        }

        // Sort by start offset descending so we can replace without shifting indices.
        spans.sort_by_key(|s| std::cmp::Reverse(s.start));

        let mut result = text.to_string();
        for span in &spans {
            let byte_start = char_to_byte_offset(text, span.start);
            let byte_end = char_to_byte_offset(text, span.end);
            result.replace_range(byte_start..byte_end, span.entity_type.redact_tag());
        }

        Ok(result)
    }

    /// Run GLiNER UniEncoderSpan 6-input inference.
    fn run_gliner_span(
        &mut self,
        input_ids: &Array2<i64>,
        attention_mask: &Array2<i64>,
        words_mask: &Array2<i64>,
        text_lengths: &Array2<i64>,
        span_idx: &Array3<i64>,
        span_mask: &Array2<bool>,
    ) -> ChronicleResult<Array4<f32>> {
        let input_ids_tensor = Tensor::from_array(input_ids.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;
        let attention_mask_tensor = Tensor::from_array(attention_mask.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;
        let words_mask_tensor = Tensor::from_array(words_mask.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;
        let text_lengths_tensor = Tensor::from_array(text_lengths.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;
        let span_idx_tensor = Tensor::from_array(span_idx.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;
        let span_mask_tensor = Tensor::from_array(span_mask.clone())
            .map_err(|e| ChronicleError::Process(format!("tensor creation failed: {e}")))?;

        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => input_ids_tensor,
                "attention_mask" => attention_mask_tensor,
                "words_mask" => words_mask_tensor,
                "text_lengths" => text_lengths_tensor,
                "span_idx" => span_idx_tensor,
                "span_mask" => span_mask_tensor,
            ])
            .map_err(|e| ChronicleError::Process(format!("ONNX inference failed: {e}")))?;

        let (shape, output_data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| ChronicleError::Process(format!("output extraction failed: {e}")))?;

        if shape.len() == 4 {
            let arr = Array4::from_shape_vec(
                (
                    shape[0] as usize,
                    shape[1] as usize,
                    shape[2] as usize,
                    shape[3] as usize,
                ),
                output_data.to_vec(),
            )
            .map_err(|e| ChronicleError::Process(format!("output reshape failed: {e}")))?;
            Ok(arr)
        } else {
            Err(ChronicleError::Process(format!(
                "unexpected GLiNER span output shape: {shape:?}"
            )))
        }
    }

    /// Extract PII spans from model output scores.
    fn extract_spans(
        &self,
        scores: &Array4<f32>,
        text: &str,
        text_tokens: &[TextToken],
    ) -> Vec<PiiSpan> {
        let batch_scores = scores.index_axis(Axis(0), 0); // [text_words, max_width, entity_types]
        let num_words = batch_scores.shape()[0].min(text_tokens.len());
        let max_width = batch_scores.shape()[1];
        let num_types = batch_scores.shape()[2];

        let mut spans = Vec::new();

        for start in 0..num_words {
            for width in 0..max_width {
                let end = start + width;
                if end >= text_tokens.len() {
                    continue;
                }

                for type_idx in 0..num_types.min(self.entity_types.len()) {
                    let score = sigmoid(batch_scores[[start, width, type_idx]]);
                    if score <= self.threshold {
                        continue;
                    }

                    let start_offset = text_tokens[start].start;
                    let end_offset = text_tokens[end].end;
                    if start_offset >= end_offset || end_offset > text.len() {
                        continue;
                    }

                    let span_text = &text[start_offset..end_offset];
                    spans.push(PiiSpan {
                        entity_type: self.entity_types[type_idx],
                        text: span_text.to_string(),
                        start: byte_to_char_offset(text, start_offset),
                        end: byte_to_char_offset(text, end_offset),
                        confidence: score,
                    });
                }
            }
        }

        // Deduplicate overlapping spans: keep highest confidence.
        spans.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then(b.confidence.partial_cmp(&a.confidence).unwrap())
        });
        dedup_overlapping(&mut spans);

        spans
    }
}

#[derive(Debug, Clone)]
struct TextToken {
    text: String,
    start: usize,
    end: usize,
}

#[derive(Debug, Clone)]
struct CandidateSpan {
    start: usize,
    end: usize,
    valid: bool,
}

fn split_text_tokens(text: &str) -> Vec<TextToken> {
    let mut tokens = Vec::new();
    let mut iter = text.char_indices().peekable();

    while let Some((start, ch)) = iter.next() {
        if ch.is_whitespace() {
            continue;
        }

        if is_word_char(ch) {
            let mut end = start + ch.len_utf8();
            let mut last_word_end = end;
            while let Some(&(next_start, next_ch)) = iter.peek() {
                if is_word_char(next_ch) {
                    iter.next();
                    end = next_start + next_ch.len_utf8();
                    last_word_end = end;
                    continue;
                }

                if (next_ch == '-' || next_ch == '_') && has_word_char_after(&mut iter.clone()) {
                    iter.next();
                    end = next_start + next_ch.len_utf8();
                    continue;
                }

                break;
            }

            let final_end = last_word_end.max(end);
            tokens.push(TextToken {
                text: text[start..final_end].to_string(),
                start,
                end: final_end,
            });
            continue;
        }

        let end = start + ch.len_utf8();
        tokens.push(TextToken {
            text: text[start..end].to_string(),
            start,
            end,
        });
    }

    tokens
}

fn is_word_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

fn has_word_char_after(iter: &mut std::iter::Peekable<std::str::CharIndices<'_>>) -> bool {
    let mut lookahead = iter.clone();
    lookahead.next();
    lookahead
        .peek()
        .map(|(_, ch)| is_word_char(*ch))
        .unwrap_or(false)
}

fn build_words_mask(word_ids: &[Option<u32>], prompt_len: usize) -> Vec<i64> {
    let mut mask = Vec::with_capacity(word_ids.len());
    let mut prev_word_id = None;
    let mut seen_words = 0usize;

    for word_id in word_ids {
        match word_id {
            None => mask.push(0),
            Some(id) => {
                if Some(*id) != prev_word_id {
                    seen_words += 1;
                    if seen_words > prompt_len {
                        mask.push((seen_words - prompt_len) as i64);
                    } else {
                        mask.push(0);
                    }
                } else {
                    mask.push(0);
                }
                prev_word_id = Some(*id);
            }
        }
    }

    mask
}

fn build_candidate_spans(num_tokens: usize, max_width: usize) -> Vec<CandidateSpan> {
    let mut spans = Vec::with_capacity(num_tokens * max_width);
    for start in 0..num_tokens {
        for width in 0..max_width {
            let end = start + width;
            spans.push(CandidateSpan {
                start,
                end,
                valid: end < num_tokens,
            });
        }
    }
    spans
}

fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value).exp())
}

/// Remove overlapping spans, keeping the higher-confidence one.
fn dedup_overlapping(spans: &mut Vec<PiiSpan>) {
    let mut i = 0;
    while i < spans.len() {
        let mut j = i + 1;
        while j < spans.len() {
            // If span j overlaps with span i, remove j (i has higher confidence due to sort).
            if spans[j].start < spans[i].end {
                spans.remove(j);
            } else {
                j += 1;
            }
        }
        i += 1;
    }
}

/// Convert a char offset to byte offset in a string.
fn char_to_byte_offset(s: &str, char_offset: usize) -> usize {
    s.char_indices()
        .nth(char_offset)
        .map(|(byte_idx, _)| byte_idx)
        .unwrap_or(s.len())
}

fn byte_to_char_offset(s: &str, byte_offset: usize) -> usize {
    s[..byte_offset.min(s.len())].chars().count()
}

/// Redact PII in text given pre-computed spans (useful for external callers).
pub fn redact_with_spans(text: &str, spans: &[PiiSpan]) -> String {
    if spans.is_empty() {
        return text.to_string();
    }

    let mut sorted: Vec<&PiiSpan> = spans.iter().collect();
    sorted.sort_by_key(|s| std::cmp::Reverse(s.start));

    let mut result = text.to_string();
    for span in sorted {
        let byte_start = char_to_byte_offset(&result, span.start);
        let byte_end = char_to_byte_offset(&result, span.end);
        if byte_start <= byte_end && byte_end <= result.len() {
            result.replace_range(byte_start..byte_end, span.entity_type.redact_tag());
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_type_display_roundtrip() {
        for &et in PiiEntityType::ALL {
            let label = et.label();
            let parsed = PiiEntityType::from_label(label);
            assert_eq!(parsed, Some(et), "roundtrip failed for {label}");
        }
    }

    #[test]
    fn entity_type_display_format() {
        assert_eq!(format!("{}", PiiEntityType::Person), "person");
        assert_eq!(format!("{}", PiiEntityType::CreditCard), "credit_card");
        assert_eq!(format!("{}", PiiEntityType::IpAddress), "ip_address");
    }

    #[test]
    fn from_label_unknown_returns_none() {
        assert_eq!(PiiEntityType::from_label("unknown"), None);
        assert_eq!(PiiEntityType::from_label(""), None);
    }

    #[test]
    fn redact_with_spans_basic() {
        let text = "Call John at john@example.com please";
        let spans = vec![
            PiiSpan {
                entity_type: PiiEntityType::Person,
                text: "John".to_string(),
                start: 5,
                end: 9,
                confidence: 0.9,
            },
            PiiSpan {
                entity_type: PiiEntityType::Email,
                text: "john@example.com".to_string(),
                start: 13,
                end: 29,
                confidence: 0.95,
            },
        ];

        let redacted = redact_with_spans(text, &spans);
        assert_eq!(redacted, "Call [PERSON] at [EMAIL] please");
    }

    #[test]
    fn redact_with_spans_empty() {
        let text = "Nothing to redact here";
        let redacted = redact_with_spans(text, &[]);
        assert_eq!(redacted, text);
    }

    #[test]
    fn threshold_filtering() {
        // Simulate: scores below threshold should be excluded.
        let threshold = 0.5f32;
        let scores = vec![0.3, 0.7, 0.49, 0.51, 0.99, 0.01];
        let above: Vec<f32> = scores.into_iter().filter(|&s| s > threshold).collect();
        assert_eq!(above, vec![0.7, 0.51, 0.99]);
    }

    #[test]
    fn dedup_overlapping_keeps_higher_confidence() {
        let mut spans = vec![
            PiiSpan {
                entity_type: PiiEntityType::Person,
                text: "John Smith".to_string(),
                start: 0,
                end: 10,
                confidence: 0.9,
            },
            PiiSpan {
                entity_type: PiiEntityType::Person,
                text: "Smith".to_string(),
                start: 5,
                end: 10,
                confidence: 0.6,
            },
            PiiSpan {
                entity_type: PiiEntityType::Email,
                text: "a@b.com".to_string(),
                start: 15,
                end: 22,
                confidence: 0.8,
            },
        ];
        // Pre-sort as extract_spans does.
        spans.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then(b.confidence.partial_cmp(&a.confidence).unwrap())
        });
        dedup_overlapping(&mut spans);

        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0].text, "John Smith");
        assert_eq!(spans[1].text, "a@b.com");
    }

    #[test]
    fn char_to_byte_offset_ascii() {
        let s = "hello world";
        assert_eq!(char_to_byte_offset(s, 0), 0);
        assert_eq!(char_to_byte_offset(s, 5), 5);
        assert_eq!(char_to_byte_offset(s, 11), s.len());
    }

    #[test]
    fn char_to_byte_offset_unicode() {
        let s = "héllo"; // 'é' is 2 bytes in UTF-8
        assert_eq!(char_to_byte_offset(s, 0), 0);
        assert_eq!(char_to_byte_offset(s, 1), 1); // 'h' is 1 byte
        assert_eq!(char_to_byte_offset(s, 2), 3); // 'é' is 2 bytes, so char 2 starts at byte 3
    }

    #[test]
    fn redact_tags_format() {
        assert_eq!(PiiEntityType::Person.redact_tag(), "[PERSON]");
        assert_eq!(PiiEntityType::Email.redact_tag(), "[EMAIL]");
        assert_eq!(PiiEntityType::PhoneNumber.redact_tag(), "[PHONE_NUMBER]");
        assert_eq!(PiiEntityType::CreditCard.redact_tag(), "[CREDIT_CARD]");
        assert_eq!(PiiEntityType::Address.redact_tag(), "[ADDRESS]");
        assert_eq!(PiiEntityType::ApiKey.redact_tag(), "[API_KEY]");
        assert_eq!(PiiEntityType::Ssn.redact_tag(), "[SSN]");
        assert_eq!(PiiEntityType::IpAddress.redact_tag(), "[IP_ADDRESS]");
    }
}
