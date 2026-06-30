//! Frame fingerprinting and adjacent-frame deduplication.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameFingerprint {
    hash: u64,
    byte_len: usize,
}

impl FrameFingerprint {
    pub fn from_parts(bytes: &[u8], normalized_text: &str) -> Self {
        // Sample-based hash: first 4KB + last 4KB of image + full text.
        // Avoids hashing entire multi-MB PNG frames on every capture.
        const SAMPLE_SIZE: usize = 4096;
        let mut hash = 0xcbf2_9ce4_8422_2325u64;

        let head = &bytes[..bytes.len().min(SAMPLE_SIZE)];
        let tail = &bytes[bytes.len().saturating_sub(SAMPLE_SIZE)..];

        for byte in head
            .iter()
            .chain(tail.iter())
            .chain(normalized_text.as_bytes())
        {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }

        // Mix in total length for collision resistance
        hash ^= bytes.len() as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);

        Self {
            hash,
            byte_len: bytes.len() + normalized_text.len(),
        }
    }

    pub fn is_duplicate_of(self, previous: Self) -> bool {
        self.hash == previous.hash && self.byte_len == previous.byte_len
    }
}

#[cfg(test)]
mod tests {
    use super::FrameFingerprint;

    #[test]
    fn detects_identical_fingerprints() {
        let first = FrameFingerprint::from_parts(b"frame", "same text");
        let second = FrameFingerprint::from_parts(b"frame", "same text");

        assert!(second.is_duplicate_of(first));
    }

    #[test]
    fn separates_different_text() {
        let first = FrameFingerprint::from_parts(b"frame", "same text");
        let second = FrameFingerprint::from_parts(b"frame", "different text");

        assert!(!second.is_duplicate_of(first));
    }
}
