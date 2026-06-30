# Capability: Cursor Agent

## 状态

- 状态：📝 SPEC Written
- Owner：Chat Runtime + Cursor Agent Provider
- 事实基线：2026-06-06 可访问的 Cursor 官方文档页面
  - `https://cursor.com/cn/docs/agent/overview`
  - `https://cursor.com/docs/agent/overview`
  - `https://cursor.com/docs/agent/tools/browser`
  - `https://cursor.com/docs/rules`
  - `https://cursor.com/docs/context/model-context-protocol`
  - `https://cursor.com/docs/background-agent`
  - `https://cursor.com/docs/cli`

## 用户与系统目标

Cradle 需要一套脱离历史债务的 Cursor Agent feature 模型，用来承载 Cursor-like 本地 agent session，以及未来可能接入的 Cursor-backed runtime。

目标用户体验是：

- 可以从 Cradle session 或 workspace 启动一个自主编码 agent；
- agent 可以理解代码、搜索、编辑文件、运行终端命令、使用浏览器自动化、获取规则、调用 MCP server，并在必要时向用户提问；
- 在重大文件变更前暴露 durable checkpoint；
- active turn 运行时允许排队 follow-up message，同时提供紧急 redirect 的 immediate-send 路径；
- 通过 Cradle message parts 和 provider UI slot 展示 provider-native plan、tool activity、terminal output、browser evidence、file diff、rules、MCP、usage 与 background-agent 状态；
- Cursor-specific 语义必须封装在 Cursor provider namespace 内，Chat Runtime 只拥有 session/run lifecycle、queue、snapshot、stream transport 和 UI projection envelope。

## Cursor 官方文档事实

Cursor Agent overview 将 Agent 描述为用于 autonomous coding tasks、terminal commands 和 code editing 的 assistant。该页面围绕 Agent 的工作方式、工具、checkpoint、queued messages 与 immediate messaging 展开。

Cursor Agent 文档中出现的工具能力包括：

- codebase search 与 semantic code search；
- 按名称搜索文件/目录、读取目录结构、在文件中查找精确关键词或 pattern；
- web search；
- 按 type 与 description 获取 rules；
- 读取文本文件与 `.png`、`.jpg`、`.gif`、`.webp`、`.svg` 等图像文件，并把它们放入 conversation context；
- 对文件提出 edit suggestion 并自动 apply；
- 通过用户终端 profile 运行 terminal command；
- 控制 browser 完成导航、交互、截图、应用测试与视觉验证；
- 根据文本或参考图生成 image，默认保存到项目 `assets/` 目录并在 chat 内 inline 展示；
- task 期间提出 clarification question，并在等待用户回答时继续读取文件、编辑或运行命令。

Cursor checkpoint 是 Agent session 期间的本地 codebase snapshot。Agent 会在重大变更前自动创建 checkpoint；用户可以在 chat timeline 中预览某个 checkpoint 的文件状态，并执行 restore。官方文档明确说明 checkpoint 存储在本地，且与 Git 分离；checkpoint 只用于撤销 Agent 改动，永久版本控制应使用 Git。

Cursor queued messages 允许用户在 Agent 正在工作时继续输入 follow-up instruction。按 Enter 会把 message 加入 queue；queued messages 会按顺序显示在 active task 下方，可以重新排序，并在当前 task 完成后依次执行。按 Cmd/Ctrl+Enter 会 immediate send，跳过 queue，把消息附加到最近的 user message 或 tool result 后并立即处理。官方文档将 immediate send 定位为紧急 follow-up、interrupt 或 redirect 当前工作的路径。

Cursor customization 文档将 Agent 行为与 rules、skills、prompts 和 MCP 联系在一起。Rules 是 provider-owned instruction/configuration layer；MCP 是外部工具扩展机制；browser automation 是工具能力 surface，不是 chat transcript format。

Cursor background/cloud agent 文档影响 planned feature：background agent 是 provider-native 的 remote/cloud work unit，可能运行在本地 foreground IDE loop 之外，因此需要独立的 status、progress、diff 与 artifact surface，不能被建模为普通 foreground chat turn。

Cursor CLI/headless 文档影响 planned feature：Cursor-style agent execution 可以存在于 interactive editor mode、CLI/headless mode 或 remote/background mode。Cradle 应把它建模为 runtime execution placement 与 provider session binding，而不是拆成彼此无关的业务概念。

## 产品范围

### 当前可复用的 Cradle 能力

- Runtime catalog 已支持 builtin 与 plugin runtime kind。
- Chat Runtime 已拥有 session response、cancellation、passive stream join、durable queue rows、runtime settings、provider UI slot state、provider-native threads 与 Codex app-server bridge。
- Provider adapter 已把 provider-native events 映射为 AI SDK `UIMessageChunk`。
- Provider UI slot 已支持 goal、compact、plan、tool activity、MCP、model、reasoning、status、diff、terminal、approvals、alerts、filesystem、search、skills、plugin、crew、usage 与 config state。
- Chat queue 已有 `queue` 与 `steer` 语义；Cursor immediate send 可以自然映射到 provider 暴露真实 side-channel 时的 live-steer path。

### 预案内 Cursor Agent Features

- `cursor-agent` runtime adapter，支持 Cursor local/headless agent execution。
- Cursor checkpoint subsystem，支持 local snapshot 与 restore preview。
- Cursor tool-state projector，覆盖 browser、file edit、terminal、MCP、web、rule fetch 与 image generation evidence。
- Cursor rule/skill/MCP discovery bridge：可以读取 external namespace，但只能写入 Cradle-owned imported/projected state。
- Cursor background-agent runtime placement，用于 cloud/remote tasks。
- Cursor CLI/headless host manager，用于 non-editor execution。
- Cursor checkpoints、queue/immediate-send、active plan、tool timeline、browser evidence、terminal output 与 background-agent status 的 runtime UI surfaces。

## 非目标

- 不在 Chat Runtime 内重新实现 Cursor model reasoning loop。
- 不写入 Cursor-owned configuration、rules、history 或 cloud agent namespaces。
- 不把 Cursor raw protocol payload 持久化为 Cradle transcript source of truth。
- 不把 Cursor native tool event name 直接暴露给 renderer 作为 stable UI API。
- 不把 background/cloud agent 折叠成 Cradle child session，除非用户明确 fork 或 import 该工作。
- 不使用 Git 实现 checkpoint。Checkpoint 是本地 undo record；Git 仍是 permanent version control。

## 概念模型

### Agent Session

Cursor Agent session 是绑定到一个 Cradle chat session 的 provider-native execution session。

Cradle 拥有：

- `sessions` row 与 title projection；
- `backend_runs` lifecycle；
- `messages.message_json` trusted AI SDK snapshots；
- queue rows 与 queue ordering；
- 用户选择的 runtime settings；
- diagnostics 所需的 durable run snapshots；
- 如果由 Cradle 创建 local snapshot，则拥有 Cradle-owned checkpoint records。

Cursor provider 拥有：

- native session id / thread id；
- provider-specific plan、tool、terminal、browser、MCP、rule 与 background task semantics；
- Cursor 暴露时的 native checkpoint metadata；
- native CLI/headless/background-agent process protocol；
- Cursor native event 到 stable Cradle provider envelope 的映射。

### Execution Placement

Cursor Agent runtime 必须显式表达 placement：

- `localEditor`：通过本地 Cursor editor/session bridge 运行；
- `localHeadless`：通过 workspace 内的 Cursor CLI/headless process 运行；
- `remoteBackground`：作为 provider/cloud background agent 运行，并异步报告 status/diff artifacts。

Placement 是 provider-owned runtime config。Chat Runtime 只能读取它来展示 catalog metadata，并校验 provider 是否能 start foreground stream、background run 或 headless run。

### Tool Evidence

Cursor tool evidence 必须拆成三层：

- transcript-positioned content：assistant text、visible tool calls、tool outputs、user clarification requests、approval requests、final summaries；
- session-scoped live state：active plan、browser snapshot、terminal command status、MCP server status、current checkpoint、background-agent status；
- forensic diagnostics：bounded raw provider events、run snapshot events、stream traces。

只有 transcript-positioned content 可以进入 `UIMessage.parts`。Session-scoped live state 通过 provider UI slot 暴露。Forensic diagnostics 留在 run snapshots/traces 内。

### Checkpoint

Checkpoint 捕获 provider significant edits 之前的 modified workspace file state。

必要概念：

- `checkpointId`：Cradle id；如果 Cursor 暴露 native id，也可以关联 provider-native id；
- `sessionId`：Cradle session；
- `runId`：创建 checkpoint 的 backend run；
- `providerCheckpointId`：nullable provider-native id；
- `workspacePath`：normalized workspace root；
- `createdAt`：timestamp；
- `reason`：provider-provided 或 Cradle-inferred reason；
- `changedFiles`：bounded file list，包含 status 与 byte size；
- `manifestJson`：restore preview 所需 metadata；
- `storageRef`：如果 Cradle 存储 file bytes，则指向 Cradle-owned snapshot storage；
- `status`：`available` / `restoring` / `restored` / `failed` / `expired`。

Restore 必须是显式用户动作。Restore 会修改 workspace，因此必须先支持 preview。

### Queue And Immediate Messaging

Cursor queued messages 映射为 Cradle queue mode：

- busy 时按 Enter 创建 mode 为 `queue` 的 `chat_session_queue_items` row；
- pending queued rows 可以 reorder；
- pending queue rows 在 active turn 进入 terminal state 后顺序 drain。

Cursor immediate messaging 映射为 Cradle live steering：

- busy 时按 Cmd/Ctrl+Enter 创建 mode 为 `steer` 的 `chat_session_queue_items` row；
- Chat Runtime 在发送到 provider side-channel 前 atomically claim 该 row；
- 如果 Cursor 接受 live steering，visible continuation message 以 `metadata.cradle.continuation.mode = "steer"` 持久化；
- 如果 Cursor 不支持或拒绝 steering，该 item 保持或返回 pending，并作为后续 queued turn drain。

这个映射保留 Cursor UX，同时保留 Cradle durable semantics。

## Ownership And Namespace Rules

### Provider Contracts

`provider-contracts` 可以增加 runtime kind `cursor-agent` 与 compatibility entries，但不能包含 Cursor protocol details。

Provider kind 应继续表达 model/account 维度。Cursor Agent 初期可以使用：

- `universal`：使用已登录 Cursor account 或 external local Cursor runtime；
- `openai-compatible`：仅当 Cursor CLI/headless mode 能通过 Cradle provider targets 显式配置 OpenAI-compatible model 时使用。

不要新增 `cursor` provider kind，除非 Cradle 真正拥有一个需要独立 secrets、model discovery 与 compatibility semantics 的 durable Cursor account/provider-target abstraction。

### Chat Runtime

Chat Runtime 拥有：

- response、queue、cancel、stream、messages、runtime status、provider threads、UI slot state、runtime settings 的 route surface；
- run lifecycle 与 terminal repair；
- queue/steer durability；
- AI SDK chunk stream boundary；
- provider UI slot payload shape；
- checkpoint 为 session-scoped artifact 时的 checkpoint HTTP route surface。

Chat Runtime 不得拥有 Cursor tool semantics、native event names、terminal behavior、browser automation semantics、rule lookup semantics 或 background-agent lifecycle internals。

### Cursor Provider

Cursor provider namespace 拥有：

- Cursor CLI/editor/headless API 的 process/client connection；
- Cradle message/context/files 到 Cursor-native input 的 input projection；
- event 到 AI SDK chunks 的映射；
- provider state 到 Cradle UI slots 的 projection；
- Cursor checkpoint bridge 与 native checkpoint ids；
- Cursor background-agent polling/streaming bridge；
- Cursor-specific diagnostics 与 bounded raw event capture。

推荐 package shape：

- `apps/server/src/modules/chat-runtime-providers/cursor-agent/provider.ts`
- `metadata.ts`
- `types.ts`
- `runtime-context.ts`
- `input-projector.ts`
- `event-to-chunk-mapper.ts`
- `state-projector.ts`
- `ui-slot-projector.ts`
- `checkpoint-store.ts`
- `background-agent-client.ts`
- `cli-process-manager.ts`
- `stream-handler.ts`
- `stream-diagnostics.ts`

### Checkpoints

如果 Cursor 暴露 native checkpoints，provider 只读取并 project 它们。如果 Cradle 创建 local checkpoint，新 store 应位于 Chat Runtime 相邻 namespace，例如 `chat-runtime-checkpoints`，因为 checkpoint 是 session/run-scoped runtime artifact。Provider 可以通过窄 callback 在 significant file edits 前请求 checkpoint creation。

Cradle checkpoint bytes 只能写到 Cradle data directories。Cradle 绝不能写入 Cursor-owned checkpoint storage。

### Rules, Skills, MCP

Rules：

- Cursor rules 是 provider-owned instruction assets；
- Cradle 可以读取 `.cursor/rules` 并把它们 project 为 provider context；
- 除非用户明确把 `.cursor/rules` 当作普通 workspace file 编辑，否则 Cradle 不得从 Cursor Agent session 写入 `.cursor/rules`；
- Cradle workflow rules 仍由 `workflow-rules` 拥有，storage 层不得与 Cursor rules 合并。

Skills：

- Cradle skills 由 `skills` 拥有；
- 如果从 Cursor namespace 发现 Cursor skills，它们只能作为 read inputs；
- imported/generated Cradle-compatible skill projections 必须写入 Cradle skill namespaces，而不是 Cursor namespaces。

MCP：

- MCP server discovery 仍由 Cradle plugin/server MCP registry 拥有；
- Cursor provider 读取 registry entries，并把 compatible servers 传给 Cursor runtime；
- Cursor provider-specific MCP status 通过 UI slot state 暴露。

## Runtime Catalog Metadata

`cursor-agent` runtime catalog entry：

```ts
export const cursorAgentRuntimeMetadata = {
  runtimeKind: 'cursor-agent',
  label: 'Cursor Agent',
  providerKinds: ['universal'],
  iconKey: 'cursor',
  surfaces: ['chat', 'jarvis'],
  description: 'Autonomous coding agent with file edits, terminal commands, browser evidence, rules, MCP, checkpoints, and background execution.',
}
```

Static capabilities：

- `supportsFileAttachments`：image-capable models 与 local file projection 可用时为 true；
- `supportsRuntimeSettings`：true；
- `supportsUiSlotState`：true；
- `supportsShellExecution`：仅当 Cursor runtime 暴露 command side-channel 时为 true；
- `supportsSteerTurn`：仅当 Cursor runtime 可以在 active work 期间接收 immediate message 时为 true；
- `supportsProviderThreads`：background-agent 或 subtask/native thread projections 可用时为 true；
- `supportsDynamicCapabilities`：true；
- `supportsHealthCheck`：true。

Draft presentation capabilities 应声明：

- rule status、MCP status、checkpoint list、background-agent list、usage 等 slash commands；
- composer state、toolbar picker、runtime panel、stream evidence slots；
- text 与 image attachment support；
- 通过现有 Cradle continuation controls 暴露 queue 与 immediate-send hints。

## API Surface

优先复用现有 Chat Runtime routes。

必须复用的 existing routes：

- `POST /chat/sessions/:sessionId/response`
- `POST /chat/sessions/:sessionId/queue`
- `PATCH /chat/sessions/:sessionId/queue/reorder`
- `DELETE /chat/sessions/:sessionId/queue/:queueItemId`
- `POST /chat/sessions/:sessionId/cancel`
- `GET /chat/sessions/:sessionId/stream`
- `GET /chat/sessions/:sessionId/messages`
- `GET /chat/sessions/:sessionId/capabilities`
- `GET /chat/sessions/:sessionId/ui-slot-states`
- `GET /chat/sessions/:sessionId/runtime-status`
- `GET /chat/runtimes`
- `GET /chat/runtimes/health`

新增 checkpoint routes：

- `GET /chat/sessions/:sessionId/checkpoints`
- `GET /chat/sessions/:sessionId/checkpoints/:checkpointId`
- `POST /chat/sessions/:sessionId/checkpoints/:checkpointId/preview-restore`
- `POST /chat/sessions/:sessionId/checkpoints/:checkpointId/restore`

新增 background-agent routes，仅在 provider-native background work 无法由 provider-thread routes 表达时添加：

- `GET /chat/sessions/:sessionId/background-agents`
- `GET /chat/sessions/:sessionId/background-agents/:agentRunId`
- `POST /chat/sessions/:sessionId/background-agents/:agentRunId/import`
- `POST /chat/sessions/:sessionId/background-agents/:agentRunId/cancel`

优先使用 provider-thread routes。只有当 provider-native background agents 需要 thread read 之外的 lifecycle controls 时，才增加 background-agent routes。

## Stream Protocol

Cursor provider 必须通过 Chat Runtime emit AI SDK `UIMessageChunk` frames。

允许的 chunk classes：

- `start`
- `text-start`
- `text-delta`
- `text-end`
- `reasoning-start`
- `reasoning-delta`
- `reasoning-end`
- `tool-input-start`
- `tool-input-delta`
- `tool-input-available`
- `tool-output-available`
- `tool-approval-request`
- `finish`
- `abort`
- `error`

Provider-native Cursor event names 不是 stable API，不能穿过 HTTP stream boundary。

Tool calls 必须使用 shared provider tool envelope：

```ts
interface ProviderToolEnvelope {
  identifier: string
  apiName: string
  args: unknown
  result?: unknown
}
```

推荐 Cursor tool identifiers：

- `cursor.search.codebase`
- `cursor.search.files`
- `cursor.web.search`
- `cursor.rules.fetch`
- `cursor.files.read`
- `cursor.files.edit`
- `cursor.terminal.command`
- `cursor.browser.session`
- `cursor.image.generate`
- `cursor.user.question`
- `cursor.mcp.tool`
- `cursor.checkpoint.create`
- `cursor.background.status`

## UI Slot State

Cursor provider 应 project 这些 slots：

- `status`：running/idle/error placement、current model/runtime、foreground/background mode；
- `plan`：current plan steps 与 completion state；
- `toolActivity`：recent active/completed tool calls；
- `terminal`：active command、exit status、stdout/stderr summaries；
- `filesystem`：changed files、pending edits、checkpoint association；
- `diff`：provider-generated 或 Cradle-computed diff summary；
- `approvals`：Cursor 暴露时的 pending tool/file/terminal approvals；
- `alerts`：permission、runtime、auth、quota、environment warnings；
- `mcp`：available servers、connected status、active MCP calls；
- `skills`：Cursor/Cradle skill availability，作为 read-only descriptors；
- `search`：active code/file/web search summaries；
- `config`：rule sources、runtime placement、terminal profile、checkpoint policy；
- `usage`：Cursor 暴露时的 account/model usage；
- `crew`：background agents、subagents 或 provider-native child work units。

Checkpoint state 可以作为 `filesystem` substate，也可以在多个 surface 需要强类型时新增 dedicated `checkpoint` UI slot。若新增 slot union，shape 必须位于 `runtime-provider-types.ts`，并保持足够 provider-neutral，方便 Codex/Claude Agent 未来复用。

## Data Model

任何新 storage 都必须使用 Drizzle migrations。

候选表：

```ts
export const chatRuntimeCheckpoints = sqliteTable('chat_runtime_checkpoints', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  runId: text('run_id').references(() => backendRuns.id, { onDelete: 'set null' }),
  runtimeKind: text('runtime_kind').notNull(),
  providerCheckpointId: text('provider_checkpoint_id'),
  workspacePath: text('workspace_path').notNull(),
  reason: text('reason'),
  changedFilesJson: text('changed_files_json').notNull(),
  manifestJson: text('manifest_json').notNull(),
  storageRef: text('storage_ref'),
  status: text('status').notNull(),
  errorText: text('error_text'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  restoredAt: integer('restored_at', { mode: 'timestamp_ms' }),
})
```

```ts
export const cursorBackgroundAgentRuns = sqliteTable('cursor_background_agent_runs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  providerRunId: text('provider_run_id').notNull(),
  runtimeKind: text('runtime_kind').notNull(),
  status: text('status').notNull(),
  title: text('title'),
  summary: text('summary'),
  diffSummaryJson: text('diff_summary_json'),
  providerStateJson: text('provider_state_json').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
})
```

在 adapter 证明需要 durable Cradle-owned checkpoint/background records 之前，不要添加这些表。第一版可先通过 backend session binding snapshots project provider-native records。

## Permission Model

Cursor Agent permissions 必须映射到 Cradle runtime settings，不要发明不兼容的名字。

推荐映射：

- `accessMode`：控制 filesystem/network/tool reach；
- `interactionMode`：控制 autonomy level 与 approval behavior；
- terminal command approval：如果 Cursor 暴露 provider-native approval，则使用 provider-native；否则 Cradle 必须在执行本地 terminal side effect 前 fail closed；
- file edit approval：可用时使用 AI SDK native tool approval chunks；
- checkpoint restore approval：始终要求 explicit user action；
- background-agent import/merge approval：始终要求 explicit user action。

Cursor provider 必须在以下情况 fail closed：

- checkpoint restore target 位于 workspace root 外；
- file edit path 逃逸 workspace root；
- terminal command 无法关联到 approved runtime setting；
- browser automation target 需要不可用权限；
- MCP server 未注册到 Cradle registry 或 ownership check 失败；
- 缺少 provider-native auth/account。

## Context Projection

Cursor provider input projection 应包含：

- latest user text 与 queued/steered continuation metadata；
- selected Cradle context parts，例如 skills；
- 从 `messages.message_json` 重建的 bounded Cradle transcript；
- workspace root 与相关 file attachments；
- runtime settings snapshot；
- registry 中可用的 MCP servers；
- 从 Cursor 与 Cradle-owned workflow-rule sources 读取的 rule descriptors，并清晰标注 owner；
- 仅通过 Chat Runtime 现有 context resolver 注入 Chronicle memory context。

不要把 raw `messages.content` 当作 history。不要用第二套 Cradle-owned Zod schema 解析 AI SDK message internals。

## Background Agent Design

Background agents 是 provider-native long-running work units。

Foreground Chat Runtime 行为：

- 启动 remote background task 时，可以创建一个 backend run；该 run 在 provider 接受任务后即可 finish；
- 后续 progress 应通过 provider-thread/background-agent reads 或 polling 观察；
- 只有 Cursor 暴露真实 side-channel 时，发送给 background task 的 user messages 才能使用 queue/steer；
- import/merge background work 必须创建可见的 Cradle transcript events 与 diffs。

UI 行为：

- background agents 出现在 runtime panel 与 provider-thread list；
- status 应区分 queued/running/waiting-for-user/completed/failed/canceled；
- diff 与 artifacts 在 import/apply 之前都是 previews；
- background task 不得静默修改本地 workspace files，除非用户明确授权 sync/apply。

## CLI / Headless Design

Cursor CLI/headless execution 应像其他 provider process integrations 一样管理：

- process manager 拥有 spawn、env、cwd、signal handling、stderr/stdout bounds 与 lifecycle cleanup；
- runtime context 拥有 workspace path、agent home path 与 env projection；
- stream handler 把 process output/protocol events 映射成 AI SDK chunks 与 provider state snapshots；
- health check 校验 binary availability、version、auth status 与 workspace access。

Frontend 或 Chat Runtime 不应直接解析 CLI stdout。CLI protocol parsing 属于 Cursor provider namespace。

## Checkpoint Implementation Standard

Checkpoint creation policy：

- 在 provider apply significant multi-file edits 前创建；
- 在 destructive file operations 前创建；
- 在 checkpoint restore 前创建；
- pure reads、search、web、MCP read-only calls、不会修改 workspace files 的 terminal commands 默认跳过，除非 provider 标记 risky。

Storage standard：

- snapshot manifests 存在 Cradle data dir；
- 对 changed files 使用 content-addressed blobs 或 compressed file copies；
- 限制单文件大小与 checkpoint 总大小；
- 不 snapshot `node_modules`、`.git`、build outputs、package caches、provider cache dirs 等 ignored huge directories；
- 在 manifest 中记录 skipped files。

Restore standard：

- preview 计算 current workspace 到 checkpoint state 的 target diff；
- restore 只写 manifest 记录的 files；
- restore 拒绝 path traversal 与 symlink escape；
- restore 前尽量先创建新的 checkpoint；
- restore result 记录到 checkpoint row 与 run snapshot event。

## Validation Plan

Provider contract tests：

- `cursor-agent` 能注册到 runtime catalog，并具有正确 provider compatibility；
- provider registration 会拒绝不一致的 static capabilities；
- health check 对 missing binary/auth 返回 structured unavailable status。

Stream mapping tests：

- Cursor text output 变成 AI SDK text chunks；
- file edit event 变成 provider tool envelope 与 final assistant snapshot；
- terminal command output 被 bounded，并分类为 terminal tool evidence；
- browser evidence 被 project 为 tool output 与 UI slot state，且不泄漏 raw protocol names；
- rule fetch 与 MCP calls 使用 stable tool identifiers；
- final stream 包含 `finish` 与 `[DONE]`。

Queue/steer tests：

- queued messages 在 active run completion 后顺序 drain；
- immediate send 只在 queue row 被 atomically claimed 后调用 provider steer；
- provider steer rejection 会把 row 返回 pending queue；
- accepted steer 会持久化 visible continuation metadata。

Checkpoint tests：

- significant edits 前会创建 checkpoint；
- preview restore 返回 diff，且不写文件；
- restore 拒绝 workspace 外路径；
- restore 写入预期 files 并记录 status；
- checkpoint storage 会跳过 ignored/oversized files，并记录 skipped reasons。

Background-agent tests：

- starting background work 记录 provider-native id，且不会让 foreground stream 无限保持打开；
- progress polling project status/diff；
- import/apply 要求 explicit user action；
- cancel 映射到 provider-native cancellation，并记录 terminal status。

Security tests：

- missing auth fail closed；
- unavailable MCP server 不能被 invoke；
- terminal/file/browser actions 遵守 runtime settings；
- provider raw payloads 在 diagnostics 中 bounded。

## Migration / Architecture Upgrade

这个 feature 不应以 old provider behavior 的 compatibility glue 实现。干净架构是：

1. 把 `cursor-agent` 作为 first-class runtime provider 加入，并拥有独立 namespace。
2. 保持 Chat Runtime 现有 provider boundary 与 AI SDK stream contract。
3. 只有 provider callback 或 native checkpoint bridge 证明需要时，才新增 checkpoint routes/storage。
4. 复用 queue/steer，不发明 Cursor-specific queue storage。
5. 复用 UI slot states，不新增 Cursor-specific renderer APIs。
6. 只有 provider-thread routes 表达能力不足时，才新增 background-agent lifecycle。

第一版实现可以破坏任何旧的 Cursor-like 假设，因为 Cradle 还没有稳定发布 Cursor Agent feature。

