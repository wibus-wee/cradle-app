# Chronicle Web Feature

此目录负责 `Settings > 记录` 的 Web UI。它把当前生成的 Chronicle API client 适配为稳定的本地 UI 类型，并以用户视角渲染记录开关、模型选择、disabled 原因提示、可记录来源、最近记录、记忆搜索、知识卡片与会议人物；更偏诊断的 Slack source sync、本地模型资源 lifecycle、accessibility evidence、raw audio segments、meeting transcripts、activity segments、pipeline runs 与 dream runs 被收纳到高级与诊断区域。

## Files

- `use-chronicle.ts`: React Query hooks 与 Chronicle canonical schema 对齐的 UI 数据层，覆盖 config、status、model resources reconcile/verify/install/remove、Slack message sources、Slack sync、Slack Events API config、accessibility evidence/events、raw audio segments、audio transcripts、speaker profiles、activity segments、activity segment triage/summarization/crystallization actions、manual activity pipeline tick、knowledge cards、dream runs、pipeline runs、timeline、memories、Server-side memory search 与手动刷新。
- `chronicle-settings.tsx`: Settings 页面实现，使用面向用户的控制卡片、provider model picker、静态 Tailwind classes 与 Chronicle hooks。首屏以「记录会把你的工作现场整理成可搜索的记忆」为主叙事，展示运行状态、主开关、模型选择、disabled 控件原因、来源概览、记录流程、最近记录、记忆搜索、知识卡片与会议人物；最近记录使用 compact feed 展示小缩略图、来源、显示器编号、时间和文本线索，便于多显示器记录快速扫描；Settings Chronicle 首屏在 Chronicle config、status、resources、message sources、evidence、activity、knowledge、timeline、memories 和当前 profile 的 Agent Runtime model cache 首轮数据 ready 后记录 performance gate；来自全局搜索的 Chronicle memory/knowledge 命中会滚动到对应区域并临时高亮具体卡片；Slack 导入、sensitive app/title/url privacy rules、本地模型资源、窗口线索、窗口事件、raw audio segment evidence、meeting transcripts、activity segment triage/summarization/crystallization、manual pipeline tick、dream merge preview/apply 与 runtime status 被放入「高级与诊断」折叠区。
- `chronicle-privacy-rules.test.tsx`: focused UI test，验证隐私规则 textarea 会按行 trim、去空值、去重，并通过 Chronicle config update 提交 `privacySensitiveAppBundleIds`、`privacySensitiveTitlePatterns` 和 `privacySensitiveUrlPatterns`。

## API Boundary

`use-chronicle.ts` 是 Web 侧唯一的 Chronicle API 边界：它假设 Server 按 canonical schema 返回数据（OpenAPI 生成 + 手写 fetch endpoints），并把结果整理成 Settings UI 需要的稳定类型。若 Server schema 变化，应更新 OpenAPI + 生成产物，再同步调整此文件；不要把 casts 或兼容逻辑扩散到 `chronicle-settings.tsx`。

## Ownership Notes

Chronicle-owned local model resources 会显示为 Chronicle resources，而不是 provider profile data。Provider profiles 只用于远程 summary generation 的 model selection。当前首个可用本地路径是 screen capture 加 OCR；audio VAD、ASR、speaker embedding extractor 与 text embedding resources 默认显示为 optional，用户可以从本地文件或目录安装、从 Server 内置且具备强校验信息的 manifest 下载、校验或移除这些资源。Web 不传任意远程 URL；远程 manifest 下载由 Server 在具备强校验信息时控制。Speaker profiles/aliases/learned embeddings 是 Chronicle 运行时数据，不属于 model resource download。

Memory search badges 显示 Server 返回的 `Keyword`、`Semantic` 或 `Hybrid` 匹配模式。安装 Chronicle `embedding` model resource 后，semantic score 来自 Server 调用 Rust local ONNX all-MiniLM embedding worker；模型缺失或 runtime 失败时 Server 会回退到 `chronicle-lexical/v1` deterministic local vector foundation。

Slack token 与 signing secret 明文只通过现有 `/secrets` 写入 Server secrets。Web 不把 token 或 signing secret 写进 Chronicle config；Chronicle source 只保存 secret refs、channel allowlist 与 realtime mode。当前 UI 支持 Events API 和 polling 两种模式：Events API 显示 callback URL 并保留 polling fallback，手动 sync 仍可作为立即拉取入口。

Accessibility UI 显示 Server 已登记的 window/accessibility evidence，包括 status、provider、app/window、element count、text preview、tree node preview 和 artifact path。窗口事件区域显示 AXObserver notification history，包括 notification、bundle、pid、dropped count 和可选 snapshot/accessibility refs。`Permission needed` 表示 macOS Accessibility permission 尚未授予；持久化记录中的 `macos-ax-observer` 表示 Rust AXObserver notification 触发了 AX tree capture；`macos-ax-tree-poll` 表示 Rust 定时轮询 frontmost app 的 AX tree；`macos-accessibility-window-inventory` 表示降级为窗口清单。

Audio Segments UI 显示 Rust daemon 已登记到 Server/DB 的 microphone/system/mixed WAV/metadata evidence，包括 active flag、RMS/peak、duration、artifact paths 以及 VAD/ASR/Speaker processing status。Rust runtime 会通过 raw audio processing-result contract 回写本地 ONNX VAD/ASR/Speaker 状态；transcript 与 speaker profile 分别由 transcript ingest 和 speaker profile API 拥有。macOS system audio 优先来自 ScreenCaptureKit audio stream，必要时才回落到可被 host 枚举到的 loopback/system-audio input device。

Meeting transcript UI 显示 Server 已导入的 transcript evidence 和派生 memory 状态；speaker profile UI 显示从 transcript labels、manual profile API 或 Rust speaker embedding runtime 学到的 Chronicle-owned speaker profiles。Background Audio 开关允许 Rust daemon 写 audio segment artifacts，并通过 status 显示 `Disabled`、`Unavailable` 或 `Armed`。

Privacy Rules UI 位于「高级与诊断 > 隐私规则」。Web 编辑 Chronicle-owned config 中的 `privacySensitiveAppBundleIds`、`privacySensitiveTitlePatterns` 和 `privacySensitiveUrlPatterns`，每行一条；保存后使用 Server 返回的 canonical config 回填 UI，因此 trim、去空值、去重结果与 daemon launch options 保持一致。同一区域保留 closed-eyes discard 占位，但控件暂时只读并显示不可用；真实 camera detector / manual closed-eyes pause flow、native overlay 和 hotkey lifecycle 仍属于 runtime/desktop 后续工作，Server 当前不会根据 `closedEyesDiscardEnabled` / `closedEyesMode` 丢弃 snapshot。

Activity Segments UI 显示 Server 从 snapshot、Slack、audio、transcript 和 memory evidence 聚合出的 Chronicle-owned activity windows，以及最近 pipeline runs 的 trigger、stage、status 和 error message。每个 segment 提供 Triage、Summarize 和 Crystallize 操作：Triage 调用 configured profile 判断保留价值，Summarize 会生成 segment summary 并写入 searchable memory，Crystallize 会生成 durable knowledge cards。Automatic Activity Pipeline 开关会控制 Server 后台 scheduler；Pipeline Runs 区域的 Tick 按钮会立即执行一次同样的自动推进逻辑。

Knowledge Cards UI 显示 Server 持久化的 title、content、dimension、type、confidence、tags、version 与 source counts。Dream Merge UI 显示 candidate run 历史，允许手动触发 preview 和显式 apply merge；当 `embedding` model resource 可用时候选由 ONNX semantic vectors 驱动，否则显示 lexical fallback 结果。Server 侧 dream scheduler 已接入 status/config，默认按 `dreamSchedulerIntervalMs` 自动执行 dry-run preview；只有显式开启 `dreamSchedulerApplyMerge` 或手动 apply merge 时才会改写知识卡。Restore/archive/prune 尚未作为 Web 可操作能力声明。
