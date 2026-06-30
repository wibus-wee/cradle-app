//! OCR abstraction for Cradle Chronicle.

use crate::error::ChronicleResult;
use crate::screen::CapturedFrame;

pub trait TextExtractor {
    fn extract_text(&self, frame: &CapturedFrame) -> ChronicleResult<OcrText>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OcrText {
    pub normalized_text: String,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct ObservedTextExtractor;

impl TextExtractor for ObservedTextExtractor {
    fn extract_text(&self, frame: &CapturedFrame) -> ChronicleResult<OcrText> {
        Ok(OcrText {
            normalized_text: normalize_observed_text(&frame.observed_text),
        })
    }
}

pub fn normalize_observed_text(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for (i, word) in input.split_whitespace().enumerate() {
        if i > 0 {
            output.push(' ');
        }
        output.push_str(word);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::normalize_observed_text;

    #[test]
    fn normalizes_whitespace() {
        assert_eq!(
            normalize_observed_text(" Cradle\n\nChronicle\tmemory  "),
            "Cradle Chronicle memory"
        );
    }
}
