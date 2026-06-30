//! Binary smoke validation for Cradle Chronicle evidence runtime.

use std::fs;
use std::process::Command;

#[test]
fn binary_smoke_writes_artifacts_and_outbox() {
    let binary = env!("CARGO_BIN_EXE_cradle-chronicle");
    let root = std::env::temp_dir().join(format!(
        "cradle-chronicle-binary-smoke-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);

    let output = Command::new(binary)
        .env("CRADLE_URL", "http://127.0.0.1:1")
        .args([
            "--smoke",
            "--storage-root",
            root.to_str().expect("temp path should be utf8"),
            "--capture-limit",
            "2",
        ])
        .output()
        .expect("binary should run");

    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("cradle chronicle smoke completed"));

    let display_root = root.join("1");
    assert!(display_root.exists());

    let segment = fs::read_dir(&display_root)
        .expect("display dir should read")
        .next()
        .expect("segment should exist")
        .expect("segment entry should read")
        .path();
    assert!(segment.join("frame-00001.jpg").exists());
    assert!(segment.join("capture-00001.json").exists());
    assert!(segment.join("ocr-00001.json").exists());
    assert!(segment.join("ocr.json").exists());
    assert!(segment.join("capture.json").exists());
    assert!(segment.join("snapshot.json").exists());

    let events =
        fs::read_to_string(root.join("outbox/events.ndjson")).expect("events should exist");
    assert!(events.contains("\"kind\":\"snapshot\""));
    assert!(events.contains("\"kind\":\"smoke-capture\""));
    assert!(!root.join("memory-manifest.json").exists());

    let _ = fs::remove_dir_all(&root);
}
