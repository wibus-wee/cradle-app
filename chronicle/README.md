# Cradle Chronicle

Cradle Chronicle 是 Cradle 的本地 evidence runtime Rust crate。它负责 screen/audio capture、本地模型诊断、本地 ONNX 推理、artifact 写入和 evidence outbox。Chronicle 的 memory、activity、knowledge、search、privacy projection、agent context 和迁移语义由 Cradle Server 与 `chronicle_*` DB tables 拥有。

Rust 不再生成 canonical memory files，也不再维护本地 memory manifest、activity pipeline、knowledge crystallization 或 dream merge。Server 暂时不可用时，Rust 仍会把本地证据写入 storage root，并把待投递事件保存到 `outbox/events.ndjson`，方便后续恢复或诊断。

## Commands

运行全部 Rust 测试：

    cargo test --manifest-path chronicle/Cargo.toml

运行 smoke evidence 管道：

    cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-smoke

运行 macOS 原生采集一次：

    cargo run --manifest-path chronicle/Cargo.toml -- --daemon --provider macos --run-once --storage-root /tmp/cradle-chronicle-macos

macOS daemon 默认枚举并采集所有 active displays。`--display-id <id>` 仅作为调试或手动限制到单个 CoreGraphics display id 的覆盖项。

smoke 运行会把 frame artifacts 写入 `/tmp/cradle-chronicle-smoke/{display_id}/{timestamp}/`。每个被接受的 frame 都会得到 `frame-00001.jpg`、`capture-00001.json` 和 `ocr-00001.json`；`capture.json`、`ocr.json` 和 `snapshot.json` 指向最新被接受的 frame。Rust runtime 还会在 storage root 下写入 `outbox/events.ndjson`，并对 Server ingest route 做 best-effort delivery。`CRADLE_URL` 不可达时 smoke 仍应成功，因为 outbox 是本地 evidence queue。

## File Inventory

- `Cargo.toml`: library 与 CLI binary 的 crate metadata。
- `src/lib.rs`: public library exports for the local evidence runtime。
- `src/main.rs`: smoke、daemon、audio diagnostics、local ONNX embedding worker、PII redaction、WAV transcription 与 speaker embedding diagnostic 的 CLI entry point。
- `src/config.rs`: runtime configuration 与 CLI/environment parsing。
- `src/error.rs`: crate error type。
- `src/json.rs`: artifact writers 使用的最小 JSON escaping helpers。
- `src/time.rs`: 不依赖外部 crate 的 UTC timestamp formatting。
- `src/ocr.rs`: OCR trait 与 observed-text extractor。
- `src/screen/`: capture traits、window observations、privacy filtering 与 synthetic capture source。
- `src/audio/`: microphone/system/mixed capture、WAV artifact writing、VAD/ASR/speaker local inference 与 platform audio capture adapters。
- `src/onnx/`: ONNX Runtime helpers、VAD/ASR/embedding/PII/speaker local model execution。
- `src/models.rs`: Chronicle local model resource path resolution and manifest metadata。
- `src/recorder/`: artifact storage、fingerprint deduplication 与 recorder orchestration。
- `src/store/`: local evidence outbox，写入 `outbox/events.ndjson` 并 best-effort 投递 Server ingest。
- `src/integrations/`: optional external integration helpers，例如 Cradle Server URL 常量与环境变量解析。
- `tests/smoke.rs`: binary-level evidence smoke test。
