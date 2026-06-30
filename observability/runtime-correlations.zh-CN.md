# Cradle Runtime Correlations 读图说明

这份文档解释 Grafana 里的 `Cradle Runtime - Correlations` dashboard。这个 dashboard 不是按模块 ownership 展示资源，而是把同一时间段里可能互相解释的信号放在一起，用来判断“哪个现象更像原因，哪个只是结果”。

## 基本读法

先看 `Pressure Timeline`，确认异常发生在哪个时间段，以及哪些压力信号同时 active。然后在同一个时间范围内看下面的关联图：

- `Memory Stack` 判断内存主要在哪个进程族。
- `Renderer Payload Shape` 判断 renderer JS heap 是否能被 chat store 数据量解释。
- `Runs, Streams, Replay` 判断 run/stream/replay 是否结束后仍然保留。
- `Provider Hosts vs Active Runs` 判断 provider host 是否跟 active run 生命周期一致。
- `Electron Inventory`、`Observability Queue State`、`Server Resource Pressure` 用来排除进程数量、telemetry 滞后、server 资源饱和。

## Pressure Timeline

这是布尔时间线。`active` 表示某个阈值被跨过，不表示已经定位到 owner。

- `renderer heap > 512 MiB`: renderer 的 JavaScript heap 使用量超过 512 MiB。
- `tab working set > 1 GiB`: Electron/Chromium Tab 进程工作集超过 1 GiB。
- `chat payload > 5M chars`: 前端 chat store 估算的 part 字符数超过 500 万。
- `replay buffer retained`: server chat runtime 仍保留 replay buffer chunk。
- `observability queue backlog`: observability 队列 depth 非零，telemetry 可能滞后。

如果多个 flag 同时 active，要看谁先开始增长、谁先回落。先增长的信号通常更像原因，后增长的信号更可能是结果。

Grafana 只负责低基数趋势。需要定位到具体 session、run、host、WebContents 时，继续看 `/observability/runtime-snapshot` 的 `drilldowns` 字段。

## Memory Stack

这个图把不同进程族的内存放在同一张图上。

- `Tab working set`: Chromium Tab 进程的工作集，包含 JS heap，也包含 DOM、layout、native allocation、canvas/media、Electron view 等内存。
- `Renderer JS heap`: renderer 报告的 JavaScript heap used。
- `Server RSS`: Cradle server 进程 RSS。
- `PTY RSS`: PTY 及其子进程 RSS。
- `Chronicle RSS`: Chronicle daemon RSS。

常见判断：

- `Tab working set` 增长，但 `Renderer JS heap` 不增长：更像 Chromium/native/DOM/layout/canvas/media 或 Electron view retention，不是纯 JS 对象膨胀。
- `Renderer JS heap` 和 `estimatedPartStringChars` 一起增长：更像前端 chat store/payload retention。
- `Server RSS` 增长，但 Tab/renderer 不增长：看 server handles、active runs、replay buffer、provider host。
- `PTY RSS` 增长：优先看 PTY role 和 descendant process。

## Renderer Payload Shape

这个图解释 renderer chat store 里保留了什么。

- `estimatedPartStringChars`: 估算 retained 字符串体积，适合看大文本、工具输出、日志块是否撑大状态。
- `messageCount`: hydrated sessions 内的 message 数量。
- `partCount`: 所有 message part 数量。
- `textPartCount`: 文本 part 数量。
- `toolPartCount`: 工具调用/工具结果 part 数量。
- `filePartCount`: 文件 part 数量。

常见判断：

- `estimatedPartStringChars` 高，但 message/part 数不高：少量大文本或大工具输出。
- `partCount`、`toolPartCount` 很高：工具调用历史太碎或保留过多。
- `messageCount` 不高但 JS heap 高：要看 part payload、React/DOM、或者非 chat store 的 renderer 状态。

## Runs, Streams, Replay

这个图把 server runtime 和 renderer streaming 状态放一起。

- `active runs`: server 当前认为仍在运行的 run。
- `replay chunks`: server 为 run 保留的 replay buffer chunk。
- `replay ... deltas`: replay buffer 里的 delta 类型分布。
- `generatingMessageCount`: renderer 当前生成中的 message 数。
- `passiveStreamingMessageCount`: renderer 保留的 passive streaming message 数。
- `activeAbortControllerCount`: renderer 仍保留的 abort controller 数。
- `runDisplayMetaCount`: renderer 保留的 run display metadata 数。
- `activeGoalCount`: renderer 仍认为 active 的 goal 数。

健康状态通常是：任务结束后 active runs、generating、abort controller 会回到 0；replay buffer 如果没有恢复需求，也应该下降或清空。

如果 active runs 已经是 0，但 replay chunks 或 passive streaming 长时间非零，说明生命周期没有完全收尾，要继续看 runtime snapshot 中的具体 run/session/provider 信息。

对应的 snapshot drill-down：

- `drilldowns.replay.topRuns`: replay buffer 最大的 run，带 sessionId/messageId/providerTarget/modelId。
- `drilldowns.renderer.activeStreamingMessages`: renderer 仍保留的 streaming message，带 sessionId/messageId、generating/passive/localDriver 状态和估算字符数。

## Provider Hosts vs Active Runs

这个图看 provider runtime host 是否跟 active run 一致。

- `provider hosts`: 当前 provider runtime host 数量。
- host state by `kind`: host 的状态维度，例如 ref/pin/expiry 相关统计。
- `active runs`: 当前 active run 数。

provider hosts 高于 active runs 不一定是 bug，可能是 host 被 pin、还有 ref count、或者处在 expiry window。异常模式是 active runs 归零后，provider hosts 长时间不下降。此时应该打开 runtime snapshot，看 host id、runtime kind、ref count、pin count、expiry。

## Electron Inventory

这个图解释 Electron 进程/窗口数量。

- `{{type}} processes`: Electron process type 计数，例如 Browser、Tab、GPU、Utility。
- `windows`: desktop 侧窗口数量。

如果 Tab/Brower/GPU working set 突然增长，先看这里有没有进程数或窗口数增长。进程数量增长可以解释 memory stack 的变化，不一定是单个 renderer 泄漏。

对应的 snapshot drill-down：

- `drilldowns.renderer.rendererWindows`: renderer window、webContentsId、rendererProcessId、route/hash、JS heap、DOM/message/tool counts。
- `drilldowns.browserPanel.liveTabs`: BrowserPanel tab 到 webContents/chromium/os process 的映射。
- `drilldowns.browserPanel.runtimes`: native BrowserPanel runtime/WebContentsView 状态，包含 attached、destroyed、loading、debuggerAttached、url/title。

## Observability Queue State

这个图看 telemetry 自己是否健康。

- `queue depth`: observability event queue 当前积压。
- state by `kind`: observability 队列/持久化状态计数。

如果 queue depth 非零或 state 异常，Grafana 图表可能比 runtime snapshot 滞后。此时不要只看 Prometheus 趋势，需要用 `/observability/runtime-snapshot` 交叉验证当前真实状态。

## Server Resource Pressure

这个图看 server 资源饱和。

- active resources by `kind`: Node active handles / requests。
- `server cpu %`: server CPU 百分比。

如果 handles、requests、CPU 与 RSS 同时增长，优先怀疑 server 资源生命周期或高负载。若这些稳定，而 renderer/Tab 增长，问题更可能在 desktop/renderer 侧。

## 当前这类内存问题的建议排查路径

1. 看 `Pressure Timeline`：确认是 Tab、renderer heap、chat payload、replay buffer 哪个先 active。
2. 看 `Memory Stack`：确认大头是 Tab working set、Renderer JS heap、Server RSS，还是 PTY/Chronicle。
3. 如果是 Tab working set 大但 JS heap 不大：继续查 Electron view、DOM/layout、native allocation、BrowserPanel/WebContents 生命周期。
4. 如果 JS heap 和 chat payload 同涨：看 `Renderer Payload Shape`，判断是大文本、大工具输出、还是 part 数过多。
5. 如果 replay/streaming 不回落：看 `Runs, Streams, Replay`，再去 runtime snapshot 查具体 run/session。
6. 如果 provider hosts 不回落：看 `Provider Hosts vs Active Runs`，再查 host ref/pin/expiry。
7. 如果 queue depth 非零：先处理 observability 滞后，避免用延迟数据判断当前状态。

## Runtime Snapshot Drill-down 字段

`GET /observability/runtime-snapshot` 现在除了 raw runtime 数据，还提供 `drilldowns`，用于从 Grafana 的趋势跳到具体对象。

- `drilldowns.renderer.rendererWindows`: 按 JS heap 排序的 renderer window 摘要。用于回答哪个 renderer/window/route 在占 heap，是否 tearoff，webContentsId 和 rendererProcessId 是什么。
- `drilldowns.renderer.topChatSessions`: 按 `estimatedPartStringChars` 排序的 renderer chat session。用于回答哪个 session 的 message/part/tool/text/file 数量最大。
- `drilldowns.renderer.activeStreamingMessages`: renderer 当前仍保留的 streaming message。用于排查 generating/passive streaming/local driver 是否未回落。
- `drilldowns.browserPanel.panel`: BrowserPanel native host 的整体状态，包括 activeThreadId、attachedRuntimeKey、runtimeCount、listener counts 等。
- `drilldowns.browserPanel.activeThreads`: 当前打开、active、有 tabs 或有 runtime 的 BrowserPanel owner/thread。
- `drilldowns.browserPanel.liveTabs`: BrowserPanel tab 到 webContentsId/chromiumProcessId/osProcessId 的映射。
- `drilldowns.browserPanel.runtimes`: native BrowserPanel runtime/WebContentsView 的 attached/destroyed/loading/debuggerAttached 状态。
- `drilldowns.replay.topRuns`: replay buffer 最大的 active run，带 chunk/delta 统计和 session/run/provider/model 关联。
- `drilldowns.providerRuntime.topHosts`: 按 ref/pin/resource/idle 排序的 provider host，带 `expiresInMs` 和 `idleForMs`。

读法：Grafana 先判断哪个曲线异常，snapshot drill-down 再定位到具体对象。例如 `Tab working set` 高但 `Renderer JS heap` 不高，优先看 `browserPanel.liveTabs` 和 `browserPanel.runtimes`；如果 `Renderer JS heap` 和 chat payload 同涨，优先看 `renderer.topChatSessions`；如果 replay 不回落，优先看 `replay.topRuns`。

## 健康信号

- 任务结束后 `active runs`、`generatingMessageCount`、`activeAbortControllerCount` 回到 0。
- `replay chunks` 不长期增长，且能随 run 生命周期回落。
- `Renderer JS heap` 与 `estimatedPartStringChars` 没有持续单调增长。
- `Tab working set` 没有持续远高于 JS heap，或者增长能被进程/窗口数量解释。
- `provider hosts` 能被 active runs、pin/ref/expiry 解释。
- `observability queue depth` 长期为 0。

## 不健康信号

- `Tab working set` 持续增长，但 `Renderer JS heap` 和 chat payload 都稳定。
- `Renderer JS heap` 与 `estimatedPartStringChars` 持续同步增长。
- active run 结束后，`replay chunks`、`passiveStreamingMessageCount`、`activeAbortControllerCount` 长时间非零。
- `provider hosts` 在 active runs 为 0 后仍长期保留。
- `observability queue depth` 长时间非零，导致图表滞后。
