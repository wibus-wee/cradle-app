//! Text embedding inference using all-MiniLM-L6-v2 ONNX model.
//!
//! Produces 384-dimensional L2-normalized embeddings via mean pooling
//! over non-padding hidden states.

use std::path::Path;

use ndarray::{Array1, Array2, Axis};
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

use crate::error::{ChronicleError, ChronicleResult};

/// ONNX-based text embedding model (all-MiniLM-L6-v2).
pub struct OnnxEmbeddingModel {
    session: Session,
    tokenizer: Tokenizer,
    dim: usize,
}

impl OnnxEmbeddingModel {
    /// Load model and tokenizer from disk.
    ///
    /// - `model_path`: path to the `.onnx` file
    /// - `tokenizer_path`: path to `tokenizer.json` (HuggingFace format)
    pub fn new(model_path: &Path, tokenizer_path: &Path) -> ChronicleResult<Self> {
        let session = super::load_session(model_path)?;

        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| ChronicleError::Process(format!("failed to load tokenizer: {e}")))?;

        Ok(Self {
            session,
            tokenizer,
            dim: 384,
        })
    }

    /// Generate embedding for a single text.
    pub fn embed(&mut self, text: &str) -> ChronicleResult<Vec<f32>> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| ChronicleError::Process(format!("tokenization failed: {e}")))?;

        let ids: Vec<i64> = encoding.get_ids().iter().map(|&x| x as i64).collect();
        let mask: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .map(|&x| x as i64)
            .collect();
        let type_ids: Vec<i64> = encoding.get_type_ids().iter().map(|&x| x as i64).collect();

        let seq_len = ids.len();

        let input_ids = Array2::from_shape_vec((1, seq_len), ids)
            .map_err(|e| ChronicleError::Process(format!("shape error: {e}")))?;
        let attention_mask = Array2::from_shape_vec((1, seq_len), mask.clone())
            .map_err(|e| ChronicleError::Process(format!("shape error: {e}")))?;
        let token_type_ids = Array2::from_shape_vec((1, seq_len), type_ids)
            .map_err(|e| ChronicleError::Process(format!("shape error: {e}")))?;

        let input_ids_tensor = Tensor::from_array(input_ids)
            .map_err(|e| ChronicleError::Process(format!("tensor error: {e}")))?;
        let mask_tensor = Tensor::from_array(attention_mask)
            .map_err(|e| ChronicleError::Process(format!("tensor error: {e}")))?;
        let type_tensor = Tensor::from_array(token_type_ids)
            .map_err(|e| ChronicleError::Process(format!("tensor error: {e}")))?;

        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => input_ids_tensor,
                "attention_mask" => mask_tensor,
                "token_type_ids" => type_tensor,
            ])
            .map_err(|e| ChronicleError::Process(format!("ONNX inference failed: {e}")))?;

        // Output shape: [1, seq_len, 384]
        let (_shape, hidden_data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| ChronicleError::Process(format!("output extraction failed: {e}")))?;

        let hidden = Array2::from_shape_vec(
            (seq_len, self.dim),
            hidden_data[..seq_len * self.dim].to_vec(),
        )
        .map_err(|e| ChronicleError::Process(format!("reshape failed: {e}")))?;

        // Mean pooling over non-padding tokens
        // hidden shape: [seq_len, dim]
        let mut pooled = Array1::<f32>::zeros(self.dim);
        let mut count = 0.0f32;

        for (i, &m) in mask.iter().enumerate() {
            if m > 0 {
                let token_hidden = hidden.index_axis(Axis(0), i);
                pooled += &token_hidden.to_owned();
                count += 1.0;
            }
        }

        if count > 0.0 {
            pooled /= count;
        }

        // L2 normalization
        let norm = pooled.dot(&pooled).sqrt();
        if norm > 0.0 {
            pooled /= norm;
        }

        Ok(pooled.to_vec())
    }

    /// Generate embeddings for a batch of texts.
    pub fn embed_batch(&mut self, texts: &[&str]) -> ChronicleResult<Vec<Vec<f32>>> {
        texts.iter().map(|t| self.embed(t)).collect()
    }

    /// Get embedding dimension (384 for MiniLM).
    pub fn dim(&self) -> usize {
        self.dim
    }

    /// Compute cosine similarity between two embeddings.
    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }
        dot / (norm_a * norm_b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity_identical() {
        let v = vec![1.0, 2.0, 3.0];
        let sim = OnnxEmbeddingModel::cosine_similarity(&v, &v);
        assert!((sim - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let sim = OnnxEmbeddingModel::cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_opposite() {
        let a = vec![1.0, 0.0];
        let b = vec![-1.0, 0.0];
        let sim = OnnxEmbeddingModel::cosine_similarity(&a, &b);
        assert!((sim + 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_zero_vector() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![0.0, 0.0, 0.0];
        let sim = OnnxEmbeddingModel::cosine_similarity(&a, &b);
        assert_eq!(sim, 0.0);
    }

    #[test]
    fn test_l2_normalization() {
        let v: Array1<f32> = Array1::from_vec(vec![3.0, 4.0]);
        let norm = v.dot(&v).sqrt();
        let normalized = &v / norm;
        let result_norm: f32 = normalized.dot(&normalized).sqrt();
        assert!((result_norm - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_l2_normalization_384d() {
        let v: Vec<f32> = (0..384).map(|i| (i as f32) * 0.01).collect();
        let arr: Array1<f32> = Array1::from_vec(v);
        let norm: f32 = arr.dot(&arr).sqrt();
        let normalized = &arr / norm;
        let result_norm: f32 = normalized.dot(&normalized).sqrt();
        assert!((result_norm - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_mean_pool_logic() {
        // Simulate 3 tokens, dim=4, mask=[1,1,0]
        let hidden = [
            vec![1.0, 2.0, 3.0, 4.0],
            vec![5.0, 6.0, 7.0, 8.0],
            vec![99.0, 99.0, 99.0, 99.0], // padding, should be ignored
        ];
        let mask = [1i64, 1, 0];
        let dim = 4;

        let mut pooled = vec![0.0f32; dim];
        let mut count = 0.0f32;
        for (i, &m) in mask.iter().enumerate() {
            if m > 0 {
                for (j, val) in hidden[i].iter().enumerate() {
                    pooled[j] += val;
                }
                count += 1.0;
            }
        }
        for v in pooled.iter_mut() {
            *v /= count;
        }

        assert_eq!(pooled, vec![3.0, 4.0, 5.0, 6.0]);
    }
}
