# Chronicle Src

Cradle Chronicle 的 Rust 源码目录。这个 crate 现在只拥有本地 evidence runtime：capture、audio、本地模型推理、artifact 写入、privacy filtering、dedup 与 outbox delivery。Chronicle 的 canonical memory、activity、knowledge、search、privacy export、agent context 和 user-facing API 由 Cradle Server 与 DB 拥有。

## Files

- `lib.rs`: evidence runtime library exports。
- `main.rs`: smoke、daemon、audio diagnostics、local ONNX embedding worker、WAV transcription、PII redaction 与 speaker embedding diagnostic 的 CLI entry point。
- `config.rs`: 从 CLI flags 与 environment variables 解析 runtime configuration。
- `error.rs`: shared error type 与 result alias。
- `json.rs`: 不依赖外部 crate 的 JSON string escaping helpers。
- `time.rs`: 不依赖外部 crate 的 UTC timestamp formatting helpers。
- `ocr.rs`: OCR text extraction trait 与 observed-text implementation。
- `daemon.rs`: daemon orchestration，负责 capture loop、idle handling、local artifacts、audio inference、accessibility evidence、outbox 写入与 best-effort Server ingest delivery。
- `models.rs`: 本地 Chronicle model resource path resolution；模型下载仍由 Server route 负责，Rust 只查找和加载本地文件。

## Directories

- `audio/`: microphone/system/mixed capture、bounded PCM buffer、RMS activity gate、本地 VAD/ASR/speaker pipeline 与 WAV artifact writer。
- `screen/`: capture source traits、synthetic capture、macOS capture 与 privacy filtering。
- `recorder/`: frame deduplication、artifact persistence 与 recorder orchestration。
- `store/`: local evidence outbox，写入 append-only `outbox/events.ndjson`，并按 event kind best-effort POST 到 Server ingest routes。
- `onnx/`: local ONNX model runtime helpers。
- `integrations/`: optional external integration helpers，例如 Cradle Server URL 常量与环境变量解析。

## Audio Diagnostics

`cradle-chronicle --audio-diagnostics` 会打开默认 microphone input device，采集一段短音频，downmix 为 mono `f32`，经过 bounded PCM buffer 与 RMS activity gate 后写入 Chronicle storage root：

- `audio/diagnostics/<timestamp>-<pid>-<sequence>-microphone-diagnostic.wav`
- `audio/diagnostics/<timestamp>-<pid>-<sequence>-microphone-diagnostic.json`

常用参数：

- `--audio-duration-ms <ms>`: 采集时长，当前 clamp 到 `100..30000` ms。
- `--audio-rms-threshold <value>`: RMS activity gate 阈值，默认 `0.02`。
- `--storage-root <path>`: artifact 写入根目录。

这个入口用于验证 microphone permission、device config、PCM pipeline 和本地 artifact 生命周期。它不会自动生成 Chronicle memory。

## Background Audio Segments

`cradle-chronicle --daemon --audio-capture` 会让 daemon 在正常 screen capture loop 之外，按间隔捕获短 audio segment，并写入 Chronicle storage root：

- `audio/segments/<timestamp>-<pid>-<sequence>-audio-segment.wav`
- `audio/segments/<timestamp>-<pid>-<sequence>-audio-segment.json`

常用参数：

- `--audio-source microphone|system|mixed`: audio source。macOS 上 `system` 优先使用 ScreenCaptureKit audio stream；如果 ScreenCaptureKit 不可用或权限被拒绝，会回落到 CPAL loopback/system-audio input device。可以用 `CRADLE_CHRONICLE_SYSTEM_AUDIO_BACKEND=cpal` 强制走 CPAL fallback，并用 `CRADLE_CHRONICLE_SYSTEM_AUDIO_DEVICE` 指定 loopback 设备名片段。
- `--audio-segment-ms <ms>`: 每段 audio capture 时长，当前 clamp 到 `100..30000` ms。
- `--audio-segment-interval-ms <ms>`: daemon 两次 audio segment capture 的最小间隔。
- `--audio-rms-threshold <value>`: RMS activity gate 阈值，默认 `0.02`。

写出 WAV/metadata 后，daemon 会记录 raw audio segment、processing result、transcript 和 speaker profile evidence 到 `outbox/events.ndjson`，并 best-effort POST 到 Server 的 `/chronicle/audio-*` 与 `/chronicle/speaker-profiles` ingest routes。Server 决定这些 evidence 是否进入 activity、memory 或 knowledge。

## Privacy Capture Rules

`cradle-chronicle --daemon` 支持配置化 sensitive capture exclusion rules：

- `--privacy-sensitive-app <bundle-id>`: 按 macOS app bundle id 排除 capture，可重复传入。
- `--privacy-sensitive-title <pattern>`: 按 window title substring 排除 capture，可重复传入，匹配时大小写不敏感。
- `--privacy-sensitive-url <pattern>`: 按 browser URL substring 排除 capture，可重复传入，匹配时大小写不敏感。

这些规则会叠加在默认 privacy filter 上。macOS provider 会在截图前用 window inventory gate 抑制敏感窗口 capture，`RecorderManager` 也会在 persistence gate 再次过滤 frame，避免 fixture/inbox 或其他 capture source 绕过规则。

## Local Embedding Worker

`cradle-chronicle --embed-texts` 从 stdin 读取 JSON：

    { "texts": ["text to embed"] }

它会加载 Chronicle model resource root 下的 `embedding/model.onnx` 和 `embedding/tokenizer.json`，用 all-MiniLM-L6-v2 ONNX runtime 输出 normalized text embeddings。这个入口是本地 worker；Server 可以通过进程边界复用它，但 embedding index 与 search 语义由 Server DB 拥有。

## Local PII Model Diagnostic

`cradle-chronicle --redact-pii` 从 stdin 读取 JSON：

    { "text": "Contact Alice at alice@example.com" }

它会加载 Chronicle model resource root 下的 `pii/gliner-pii-basemodel.onnx` 和 `pii/tokenizer.json`，运行 GLiNer ONNX detector，并输出 detected spans 与 redacted text。这个入口是 local-only；模型缺失时只报告本地路径和 `CRADLE_MODELS_DIR` 提示。

## Local Audio Model Diagnostics

安装 Chronicle 本地 audio models 后，可以不启动 Cradle Server，直接用 WAV 文件验证本地 VAD、ASR 和 speaker embedding runtime：

    cradle-chronicle --transcribe-wav ./sample.wav
    cradle-chronicle --embed-speaker-wav ./sample.wav

`--transcribe-wav` 会读取 16-bit PCM 或 32-bit float WAV，downmix 为 mono，必要时线性重采样到 16 kHz，然后运行本地 Silero VAD、SenseVoice ASR 与 speaker embedding pipeline。它依赖 Chronicle model resource root 下的 `audio-vad/`、`audio-asr/sensevoice/` 和 `speaker/` 文件。

如果 SenseVoice 没有产出文本或本地 ONNX path 失败，`--transcribe-wav` 与 daemon audio transcript path 会尝试 whisper.cpp CLI fallback。需要显式提供 `CRADLE_CHRONICLE_WHISPER_BIN` 和 `CRADLE_CHRONICLE_WHISPER_MODEL`，可选 `CRADLE_CHRONICLE_WHISPER_ARGS`；fallback 会执行真实 binary，不会生成 synthetic transcript。

`--embed-speaker-wav` 使用同一 WAV 读取与重采样路径，只加载 speaker embedding extractor，输出 model id、version、sample count、embedding dimensions、L2 norm 和前几个 embedding values。

## External Integration Boundary

Rust Chronicle 可以在没有 Server 的情况下写出 artifacts 和 `outbox/events.ndjson`，但这些本地文件不是 canonical Chronicle product state。Server 可用时，Rust 会对 snapshot、accessibility event、raw audio segment、audio transcript、speaker profile 和 audio processing result 事件执行 best-effort ingest delivery。Server 不可用时，outbox 保留 evidence，后续恢复机制可以从 outbox 重放。

Cradle Server 拥有 Chronicle ingest、activity segmentation、summarization、memory index、knowledge crystallization、dream maintenance、privacy export 和 agent context。Rust 不再生成 canonical memory Markdown 或 `memory-manifest.json`。

## Transcript Inbox

Daemon 每轮都会以 bounded batch 扫描 `CHRONICLE_INBOX_ROOT/audio-transcripts/*.json`。这些 JSON 文件必须符合 Server `/chronicle/audio-transcripts` ingest body：至少包含 `sourceId` 与 `segments`。成功写入 outbox 后，文件会移动到 `CHRONICLE_INBOX_ROOT/audio-transcripts/processed/`；无法解析的文件会留在原处等待修正。

## Runtime Cleanup

Daemon 会定期清理 runtime housekeeping 文件：

- 删除确认陈旧的 `chronicle-started.pid`。
- 删除超过 7 天的 `inbox/processed` 与 `inbox/audio-transcripts/processed` 文件。
- 删除 cleanup 后变空的 processed inbox 子目录。

cleanup 不删除 frame、capture、OCR、accessibility、snapshot、audio segment、transcript、speaker profile artifacts 或 outbox evidence。
