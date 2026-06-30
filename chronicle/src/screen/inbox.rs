//! Inbox-backed capture source for Cradle desktop integration.

use std::fs;
use std::path::Component;
use std::path::{Path, PathBuf};

use crate::error::{ChronicleError, ChronicleResult};
use crate::screen::{
    AccessibilityCapture, AccessibilityCaptureStatus, BrowserWindowObservation, CaptureSource,
    CapturedFrame,
};
use crate::time::Timestamp;

pub struct InboxCaptureSource {
    manifests: Vec<PathBuf>,
    index: usize,
}

impl InboxCaptureSource {
    pub fn new(inbox_root: impl Into<PathBuf>) -> ChronicleResult<Self> {
        let inbox_root = inbox_root.into();
        let mut manifests = Vec::new();
        if inbox_root.exists() {
            for entry in fs::read_dir(&inbox_root)
                .map_err(|source| ChronicleError::io_at(&inbox_root, source))?
            {
                let entry = entry?;
                let path = entry.path();
                if path.extension().and_then(|value| value.to_str()) == Some("capture") {
                    manifests.push(path);
                }
            }
        }
        manifests.sort();
        Ok(Self {
            manifests,
            index: 0,
        })
    }
}

impl CaptureSource for InboxCaptureSource {
    fn next_frame(&mut self) -> ChronicleResult<Option<CapturedFrame>> {
        if self.index >= self.manifests.len() {
            return Ok(None);
        }
        let manifest_path = self.manifests[self.index].clone();
        self.index += 1;
        let frame = read_manifest(&manifest_path)?;
        mark_processed(&manifest_path)?;
        Ok(Some(frame))
    }
}

fn read_manifest(manifest_path: &Path) -> ChronicleResult<CapturedFrame> {
    let manifest = fs::read_to_string(manifest_path)
        .map_err(|source| ChronicleError::io_at(manifest_path, source))?;
    let base_dir = manifest_path.parent().ok_or_else(|| {
        ChronicleError::InvalidArgument(format!(
            "manifest has no parent directory: {}",
            manifest_path.display()
        ))
    })?;

    let display_id = parse_u32(&manifest, "display_id")?;
    let frame_index = parse_u64(&manifest, "frame_index")?;
    let captured_at = Timestamp::from_seconds(parse_u64(&manifest, "captured_at_epoch")?);
    let image_path =
        resolve_manifest_relative_path(base_dir, &parse_string(&manifest, "image_path")?)?;
    let text_path =
        resolve_manifest_relative_path(base_dir, &parse_string(&manifest, "text_path")?)?;
    let title = parse_string(&manifest, "title").unwrap_or_else(|_| "Cradle Capture".to_string());
    let bundle_id =
        parse_string(&manifest, "bundle_id").unwrap_or_else(|_| "app.cradle.desktop".to_string());
    let url = parse_string(&manifest, "url")
        .ok()
        .filter(|value| !value.is_empty());
    let is_private = parse_bool(&manifest, "is_private").unwrap_or(false);

    let bytes = read_bounded_file(&image_path, MAX_IMAGE_BYTES, "image")?;
    let observed_text = String::from_utf8(read_bounded_file(&text_path, MAX_TEXT_BYTES, "text")?)
        .map_err(ChronicleError::Utf8)?;
    let frame_extension = image_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();

    let mut window = BrowserWindowObservation::new(1, title, bundle_id);
    if let Some(url) = url {
        window = window.with_url(url);
    }
    if is_private {
        window = window.with_private_flag();
    }

    let windows = vec![window];
    Ok(CapturedFrame {
        display_id,
        frame_index,
        captured_at,
        bytes,
        frame_extension,
        observed_text,
        accessibility: AccessibilityCapture::from_windows(
            &windows,
            AccessibilityCaptureStatus::Ready,
        ),
        windows,
    })
}

const MAX_IMAGE_BYTES: usize = 100 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;

fn resolve_manifest_relative_path(base_dir: &Path, value: &str) -> ChronicleResult<PathBuf> {
    let relative = PathBuf::from(value);
    if value.trim().is_empty()
        || relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(ChronicleError::InvalidArgument(format!(
            "manifest path must stay inside inbox: {value}"
        )));
    }
    Ok(base_dir.join(relative))
}

fn read_bounded_file(path: &Path, max_bytes: usize, label: &str) -> ChronicleResult<Vec<u8>> {
    let metadata = fs::metadata(path).map_err(|source| ChronicleError::io_at(path, source))?;
    if metadata.len() > max_bytes as u64 {
        return Err(ChronicleError::Process(format!(
            "inbox {label} exceeds {} MB limit: {}",
            max_bytes / (1024 * 1024),
            path.display()
        )));
    }
    fs::read(path).map_err(|source| ChronicleError::io_at(path, source))
}

fn mark_processed(manifest_path: &Path) -> ChronicleResult<()> {
    let parent = manifest_path.parent().ok_or_else(|| {
        ChronicleError::InvalidArgument(format!(
            "manifest has no parent directory: {}",
            manifest_path.display()
        ))
    })?;
    let processed_dir = parent.join("processed");
    fs::create_dir_all(&processed_dir)
        .map_err(|source| ChronicleError::io_at(&processed_dir, source))?;
    let processed_path =
        processed_dir.join(manifest_path.file_name().ok_or_else(|| {
            ChronicleError::InvalidArgument("manifest has no file name".to_string())
        })?);
    fs::rename(manifest_path, &processed_path)
        .map_err(|source| ChronicleError::io_at(&processed_path, source))?;
    Ok(())
}

fn parse_string(manifest: &str, key: &str) -> ChronicleResult<String> {
    let prefix = format!("{key}=");
    manifest
        .lines()
        .find_map(|line| line.strip_prefix(&prefix))
        .map(percent_decode)
        .ok_or_else(|| ChronicleError::InvalidArgument(format!("missing manifest key: {key}")))
}

fn parse_u32(manifest: &str, key: &str) -> ChronicleResult<u32> {
    parse_string(manifest, key).and_then(|value| {
        value
            .parse::<u32>()
            .map_err(|_| ChronicleError::InvalidArgument(format!("invalid u32 key: {key}")))
    })
}

fn parse_u64(manifest: &str, key: &str) -> ChronicleResult<u64> {
    parse_string(manifest, key).and_then(|value| {
        value
            .parse::<u64>()
            .map_err(|_| ChronicleError::InvalidArgument(format!("invalid u64 key: {key}")))
    })
}

fn parse_bool(manifest: &str, key: &str) -> ChronicleResult<bool> {
    parse_string(manifest, key).and_then(|value| match value.as_str() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(ChronicleError::InvalidArgument(format!(
            "invalid bool key: {key}"
        ))),
    })
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
        {
            output.push(high * 16 + low);
            index += 3;
            continue;
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::screen::CaptureSource;

    use super::InboxCaptureSource;

    #[test]
    fn reads_capture_manifest_and_marks_processed() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-inbox-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("inbox should create");
        fs::write(root.join("frame.png"), b"png bytes").expect("image should write");
        fs::write(root.join("frame.txt"), "visible text").expect("text should write");
        fs::write(
            root.join("frame.capture"),
            concat!(
                "display_id=1\n",
                "frame_index=7\n",
                "captured_at_epoch=1779127000\n",
                "image_path=frame.png\n",
                "text_path=frame.txt\n",
                "title=Cradle%20Window\n",
                "bundle_id=app.cradle.desktop\n",
                "url=\n",
                "is_private=false\n"
            ),
        )
        .expect("manifest should write");

        let mut source = InboxCaptureSource::new(&root).expect("source should create");
        let frame = source
            .next_frame()
            .expect("source should read")
            .expect("frame should exist");

        assert_eq!(frame.display_id, 1);
        assert_eq!(frame.frame_index, 7);
        assert_eq!(frame.frame_extension, "png");
        assert_eq!(frame.observed_text, "visible text");
        assert!(root.join("processed/frame.capture").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_manifest_paths_outside_inbox() {
        let root = std::env::temp_dir().join(format!(
            "cradle-chronicle-inbox-traversal-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("inbox should create");
        fs::write(root.join("frame.txt"), "visible text").expect("text should write");
        fs::write(
            root.join("frame.capture"),
            concat!(
                "display_id=1\n",
                "frame_index=7\n",
                "captured_at_epoch=1779127000\n",
                "image_path=../secret.png\n",
                "text_path=frame.txt\n"
            ),
        )
        .expect("manifest should write");

        let mut source = InboxCaptureSource::new(&root).expect("source should create");
        let error = source.next_frame().expect_err("path traversal should fail");

        assert!(error.to_string().contains("inside inbox"));

        let _ = fs::remove_dir_all(&root);
    }
}
