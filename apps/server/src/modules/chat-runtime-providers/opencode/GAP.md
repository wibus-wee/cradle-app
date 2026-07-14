# opencode Provider 能力差距分析

> Cradle `OpencodeProvider` 当前实现 vs opencode SDK 原生能力之间的差距。

## 总览

| 类别 | Opencode SDK 能力 | Cradle 实现 | 优先级 |
|------|:-:|:-:|:-:|
| Title 生成 | `small_model` config、`session.summarize()`、`session.get()`、`session.update()` | ✅ 已实现 | 高 |
| Slash Commands | `command` config、`client.command.list()`、`session.command()` | ✅ 已实现列表投影与 `/command` 路由 | 高 |
| Shell 执行 | `session.shell()` | ✅ `supportsShellExecution: true` | 高 |
| 呈现能力 (Presentation) | command/slot 系统 | ✅ 已实现 `getPresentation`/`getDraftPresentation` | 高 |
| Event-first Turn | `event.subscribe()` + `session.promptAsync()` | ✅ session-scoped 持续 event pump；同时投影 `message.*` 与 `session.next.*`；prompt/idle recovery 有上限 | 高 |
| Permission Approval | `permission.updated` + `postSessionIdPermissionsPermissionId()` | ✅ 已接入 Chat Runtime pending tool approval | 高 |
| File/Image 输入 | `FilePartInput` | ✅ AI SDK file part 会投影为 opencode file part | 高 |
| Native MCP 配置 | `Config.mcp` local/remote servers | ✅ 继承用户 OpenCode config 与 workspace project scope；Cradle plugin registry 不做跨 namespace 投影 | 高 |
| MCP 生命周期管理 | `mcp.add/connect/disconnect/auth.*` | ⏸ 只读取原生 `mcp.status()` 状态；未提供 Cradle UI/route 管理 OpenCode MCP 生命周期 | 中 |
| Provider Threads / Fork | `session.list/get/messages/delete/fork()` | ✅ 已接入 Chat Runtime provider-thread 与 side-chat fork hooks | 中 |
| UI Slot 状态 | `session.status()`、`session.todo()`、`session.diff()`、`mcp.status()`、`file.status()`、permission/question lifecycle、task/subagent bindings | ✅ 已实现 status/model/progress/diff/approvals/MCP/filesystem/agents/user-input 状态；crew 来自当前 session 创建的 task/subagent，不来自全局支持列表；step/compact 仍走 stream evidence | 中 |
| Provider Thread Metadata | `session.share`、`session.summary`、`session.revert`、`session.children()` | ✅ provider-thread source/threadSource 包含 shareUrl、summary、revert、childCount | 中 |
| Steer Turn | `session.revert()` / `session.unrevert()` | ⏸ 未声明；Chat Runtime hook 是 live-turn steer，opencode 当前无等价 active-turn API | 中 |
| 回滚 (Rollback) | `session.messages()` + `session.revert()` | ✅ `supportsLastTurnRollback: true` | 中 |
| btw / Quick Question | SDK 无原生 no-history 概念 | ✅ 临时 opencode session + transcript prompt，不写 Cradle 历史 | 中 |
| Structured User Input | v2 `session.question.list/reply/reject()` + `question` tool parts | ✅ 已接入 Chat Runtime `requestUserInput`，按当前 session 的 pending question request 回写 OpenCode | 中 |
| Skills | v2 `SkillV2Info.slash` | ⏸ 当前 adapter 使用 SDK v1 surface，未读取 v2 skills | 低 |
| Runtime 设置 | SDK 支持 mode/agent 切换 | ✅ `supportsRuntimeSettings: true`；default→`build`，plan→`plan`，每 turn 生效 | 低 |

## 详细分析

### 1. Title 生成

**SDK 可用资源**:
- Config: `small_model` — 专门为 title 等轻量任务指定模型
- Config (v2): `agent.title` — 专用于 title 生成的 agent 配置
- API: `session.summarize({ providerID, modelID })` — POST `/session/{id}/summarize`
- API: `session.update({ title })` — PATCH `/session/{id}` 直接设置标题

**Cradle 接口**: `ChatRuntime.generateSessionTitle(input: GenerateSessionTitleInput): Promise<string | null>`

**当前实现**: 利用 `small_model` 或主模型调用 `session.summarize()`。在 `@opencode-ai/sdk@1.17.11` 中 `session.summarize()` 返回 `boolean`，标题需要再通过 `session.get()` 读取；adapter 会将非空标题通过 Chat Runtime title hook 返回。

### 2. Slash Commands

**SDK 可用资源**:
- Config 字段 `command`:
  ```ts
  command?: {
    [key: string]: {
      template: string
      description?: string
      agent?: string
      model?: string
      subtask?: boolean
      variant?: string  // v2 only
    }
  }
  ```
- API: `client.command.list()` — GET `/command` — 列出所有可用命令
- API: `session.command({ body: { command, text? } })` — POST `/session/{id}/command` — 执行命令
- SDK `Command` 类型:
  ```ts
  type Command = {
    name: string
    description?: string
    agent?: string
    model?: string
    source?: "command" | "mcp" | "skill"
    template: string
    subtask?: boolean
    hints: Array<string>
  }
  ```

**Cradle 接口**: 
- `getPresentation(input) → RuntimePresentationCapabilities` (含 `slashCommands: RuntimeSlashCommand[]`)
- `getDraftPresentation() → RuntimePresentationCapabilities`

**当前实现**: 
1. 通过 live SDK server 的 `client.command.list()` 读取命令列表
2. 映射为 `RuntimeSlashCommand[]` 通过 `getPresentation` 暴露
3. `streamTurn` 识别已注册 `/command` 文本并路由到 `session.command()`；未匹配的普通 prompt 走持续 event pump + `session.promptAsync()`。

### 3. btw / Quick Question

**概念**: Cradle 的 "btw" 是一种不记入历史记录的快速提问模式，在 Claude Agent 中实现为 `RuntimeUiSlot`:
```ts
{ name: 'btw', commandText: '/btw ', surfaces: ['slashCommand', 'composerState'] }
```

**SDK 对应**: opencode SDK **没有**直接对应的概念。当前实现创建临时 opencode session，用 Cradle transcript 构造轻量 prompt，完成后删除临时 session。

**Cradle 接口**: `ChatRuntime.quickQuestion?()`

### 4. Shell 执行

**SDK 可用资源**:
- API: `session.shell({ body: { command } })` — POST `/session/{id}/shell`

**Cradle 接口**: `ChatRuntime.executeShellCommand?(input): Promise<ExecuteShellCommandResult>`

**当前状态**: `supportsShellExecution: true`，`executeShellCommand` 调用 `session.shell()`，再读取对应 message parts 投影 stdout/stderr。

### 5. 呈现能力 (Presentation)

**SDK 可用资源**:
- `client.command.list()` — 获取可用命令
- opencode 的事件流含 step/agent 状态信息

**Cradle 接口**:
- `getPresentation(input: GetCapabilitiesInput): Promise<RuntimePresentationCapabilities>`
- `getDraftPresentation(): Promise<RuntimePresentationCapabilities> | RuntimePresentationCapabilities`

`RuntimePresentationCapabilities`:
```ts
{
  runtimeKind: RuntimeKind
  slashCommands: RuntimeSlashCommand[]
  uiSlots: RuntimeUiSlot[]
  skills: string[]
}
```

**当前状态**: 已实现。`getDraftPresentation()` 返回静态 slot；`getPresentation()` 额外读取 opencode command list。

### 6. Event-first Turn / Permission / Input

**SDK 可用资源**:
- `event.subscribe()` — OpenCode SSE 事件流
- `session.promptAsync()` — 接收 prompt 后立即返回 204，后续结果通过事件流到达
- `session.message()` — 读取终态 assistant message，用于恢复 SSE 可能漏掉的 parts
- `permission.updated` / `permission.replied` — OpenCode 权限请求事件
- `postSessionIdPermissionsPermissionId()` — 回复权限请求，body 为 `{ response: "once" | "always" | "reject" }`
- `FilePartInput` — prompt body 中的文件/图片输入

**当前状态**:
- OpenCode provider 现在按 Cradle runtime session 维护持续 `event.subscribe()` pump；turn 只挂 active subscriber，不再为每个 turn 创建并关闭临时 SSE 订阅。订阅失败会在 prompt dispatch 前作为 provider error 暴露，避免 prompt 已接受但 Cradle 无法观察结果。
- 普通 prompt 读取当前 session 已有 message id 作为 recovery baseline，然后调用不带自定义 `messageID` 的 `session.promptAsync()`。
- projector 同时支持旧 root `message.*` 事件族与新 v2 `session.next.*` 事件族。`session.next.text.*`/`reasoning.*`/`tool.*`/`step.*` 会投影为 AI SDK text/reasoning/tool/finish chunks；`session.next.step.failed` 会让 active turn 以 provider error 结束。
- 文本 projector 使用 overlap-aware merge，`message.part.delta` 先于完整 part snapshot 到达时不会把已有文本重复成 `HelHel`。
- adapter 用“不在 baseline 中的新 terminal assistant message”识别旧事件族的终态 message；终态时再读 `session.message()` 补偿 missed parts，然后发 AI SDK `finish`。projector 也会忽略 baseline 内的旧 message，避免第二轮复用 session 时重放上一轮文本。
- `promptAsync` accepted 后会启动 bounded recovery：按短延迟尝试从 `session.messages()` 读取终态 assistant；若没有任何 provider activity，会以明确 stuck provider error 结束。session idle 早于 assistant activity，或 tool-call finish 后没有 final assistant，也会由 idle watchdog 在有界时间内失败，而不是无限等待。
- `permission.updated` 被投影为 AI SDK `tool-input-*` + `tool-approval-request` chunks，approval id 形如 `server-request-${permission.id}`，builtin apiName 为 `approval.permissions`；用户审批后回复 OpenCode `once` 或 `reject`。
- `projectOpencodePromptParts()` 支持 text 与 file parts，AI SDK `file.mediaType/filename/url` 会映射到 OpenCode `mime/filename/url`。

### 7. Provider Threads / Fork

**SDK 可用资源**:
- `session.list()` — 列出 OpenCode sessions
- `session.get()` — 读取 session metadata
- `session.messages()` — 读取 session message/parts
- `session.delete()` — 删除 session
- `session.fork()` — fork native OpenCode session

**当前状态**:
- `listProviderThreads()`、`readProviderThread()`、`deleteProviderThread()`、`listProviderThreadTurns()` 已接入 Chat Runtime provider-thread API。
- `forkRuntimeSession()` 已接入 side-chat native fork；当父 session 有 OpenCode provider session id 时，side conversation 优先走 `session.fork()`。

### 8. Native MCP 配置与生命周期

**SDK 可用资源**:
- Config 字段 `mcp`:
  - local MCP: `{ type: "local", command: string[], environment?, enabled? }`
  - remote MCP: `{ type: "remote", url: string, headers?, oauth?, enabled? }`
- API: `mcp.status()` — 读取当前 workspace directory 下 MCP server 状态
- API: `mcp.add()`、`mcp.connect()`、`mcp.disconnect()`、`mcp.auth.start()`、`mcp.auth.callback()`、`mcp.auth.authenticate()`、`mcp.auth.remove()` — OpenCode 原生 MCP server 生命周期与 OAuth 管理

**Cradle 接口**: OpenCode provider 使用用户原生的 OpenCode config、auth、project scope 与 MCP 配置。`runtime-context.ts` 按 binary path 和 workspace cwd 池化 managed `opencode serve` 进程，不设置 `OPENCODE_CONFIG_CONTENT`、`OPENCODE_CONFIG_DIR`、`OPENCODE_DB` 或 `OPENCODE_DISABLE_PROJECT_CONFIG`，也不向 active workspace 写入 Cradle-owned OpenCode 配置。Cradle plugin registry 当前不会投影进 native OpenCode host；插件 MCP 与 OpenCode 原生 MCP 的生命周期保持各自 namespace 所有权。

**当前状态**: OpenCode host 继承用户原生 MCP 配置，Cradle plugin registry 不会投影为 OpenCode local/remote MCP。`getUiSlotStates()` 通过 `mcp.status()` 读取当前 workspace 的原生状态。尚未实现面向用户的 Cradle MCP lifecycle UI/route：用户还不能在 Cradle 内对 OpenCode 调用 `mcp.add/connect/disconnect/auth.*`。

### 9. UI Slot 状态

**SDK 可用资源**: `session.status()`、`session.todo()`、`session.diff()`，以及事件流中的 `agent`、`subtask`、`step-start`、`step-finish`、`compaction` 等事件。

**Cradle 接口**: `getUiSlotStates?(input): Promise<RuntimeUiSlotState[]>`

**当前状态**: 已实现 status/model/progress/diff/approvals/MCP/filesystem/agents/user-input 这类可直接读取或由 permission/question bridge 明确维护的状态。MCP 通过 `mcp.status()` 投影为 Cradle `mcp` slot；文件状态通过 `file.status()` 投影为 `filesystem` slot；OpenCode crew 通过当前 provider session 创建的 task/subagent binding 投影，不再把 `app.agents()` 的全局支持列表当作运行中的 crew。step/compact 等 provider 事件仍以 `data-runtime-event` 形式进入 stream evidence，不在 polled slot state 中猜测生命周期。

### 10. Steer Turn / Rollback

**SDK 可用资源**:
- `session.revert()` — POST `/session/{id}/revert`
- `session.unrevert()` — POST `/session/{id}/unrevert`

**Cradle 接口**:
- `steerTurn?(input): Promise<void>`
- `rollbackLastTurn?(input): Promise<RollbackLastTurnResult>`

**当前状态**:
- `rollbackLastTurn()` 已实现：读取完整 native message history，按请求的 turn 数选择历史 assistant message 后调用 `session.revert()`，不回滚工作区文件。
- `steerTurn` 未声明：Cradle 当前 hook 面向 active turn live steering，opencode v1 SDK 暴露的是 session revert/unrevert primitive，不具备同等语义。

### 11. Structured User Input

**SDK 可用资源**: `@opencode-ai/sdk@1.17.11` 的 root event stream 会把结构化提问表现为 `question` tool part；同包 v2 surface 暴露 session-scoped `session.question.list()`、`session.question.reply()`、`session.question.reject()`，pending request 带 `tool.callID` 可与 tool part 对齐。

**Cradle 接口**: Chat Runtime 已有 `ProviderContext.requestUserInput`、pending user-input registry、`/chat/sessions/:sessionId/user-input/:requestId` route 和 web composer/runtime-panel UI。

**当前状态**: 已实现 OpenCode question bridge。adapter 在 active session 收到 `question` tool running input 后，从 v2 pending question list 中按 `tool.callID` 找到当前 request，调用 Cradle 通用 `requestUserInput`，用户提交后用 v2 session question reply 按原问题顺序回写答案。reload/missed event recovery 也已接入：`getUiSlotStates()` 会读取 v2 session question list 投影为 `userInput` slot；Cradle `/chat/sessions/:sessionId/user-input/:requestId` 在内存 pending 丢失时会回退到 provider `submitUserInput()`，由 OpenCode adapter 直接回复 v2 pending question。

## OpenCode v2 Endpoint 对齐

`@opencode-ai/sdk@1.17.11` 同时暴露 root SDK surface 和 `/api/*` v2 surface。当前 adapter 主要使用 root surface，question bridge 与 context usage 已使用 v2 session endpoint。下面按 Cradle ownership/kit 状态分类。

### 已有 Cradle kit，OpenCode adapter 还没完全接

| v2 endpoint | OpenCode 能力 | Cradle 对应 kit | 当前差距 | 优先级 |
|------|------|------|------|------|
| `/api/health`、`/api/location` | runtime health/location | `ChatRuntime.healthCheck`、resource/observability | OpenCode provider 未实现 healthCheck；Resource Panel 只看进程级状态 | 中 |
| `/api/model`、`/api/provider`、`/api/provider/{providerID}` | runtime model/provider catalog | `listModels`、runtime-owned provider targets | 当前仍以 root `provider.list()` 为主；v2 provider detail 未用于 enrich provider target/model capabilities | 中 |
| `/api/session/{sessionID}/model`、`/api/session/{sessionID}/agent` | session sticky model/agent switch | `sessionModelSwitch`、`updateRuntimeSettings`、per-turn `modelId/agentId` | adapter 现在每 turn 带 model/agent，`updateRuntimeSettings()` no-op；未把 v2 sticky switch 接入 session settings | 中 |
| `/api/session/{sessionID}/wait` | 等 session agent loop idle，204 无 payload | stream close/recovery 内部能力 | 当前靠 SSE terminal/idle + history recovery；可用 v2 wait 作为 promptAsync 后 completion recovery barrier，再读 history/context；不能替代流式 chunks/result | 中 |
| `/api/session/{sessionID}/context` | active context messages after compaction，含 user files/agents、shell command/output、assistant tool outputPaths/tokens | `getContextUsage` | ✅ 已实现 OpenCode `getContextUsage`，按 v2 context messages 汇总 assistant token breakdown，并在 raw message 中保留 files/commands/outputPaths | 已接 |
| `/api/pty/*` | OpenCode PTY list/create/remove/update/connect token | `listBackgroundTerminals`、`terminateBackgroundTerminal`，以及 Cradle PTY module | provider 未实现 background terminal list/terminate；interactive connect 还缺 runtime-provider PTY socket bridge | 中 |
| `/api/skill` | native OpenCode skills | `RuntimePresentationCapabilities.skills`、`RuntimeSkillsUiSlotState` | presentation.skills 为空；skills slot 未读取 OpenCode skill list | 低 |
| `/api/command` | v2 slash command list | `getPresentation` | 当前用 root `command.list()`，可迁到 v2 但不是功能缺口 | 低 |
| `/api/permission/request`、`/api/session/{sessionID}/permission` | pending permission list/reply；`/api/permission/request` 是按 location 列 pending，session endpoint 是按 session 列 pending | pending tool approval + approvals slot | 当前只从 events 维护 active/recent approvals；missed event/reload 后不能从 v2 pending list 恢复。它和 saved permissions 不同，不是另一个隐藏用途 | 中 |
| `/api/question/request`、`/api/session/{sessionID}/question` | pending question list/reply/reject；global endpoint 按 location，session endpoint 按 session | pending user input + userInput slot | ✅ active turn 与 reload/missed event recovery 已接；仍可补 reject/timeout UI 行为 | 已接 |

### OpenCode 有能力，但 Cradle 还没有明确 ChatRuntime kit

| v2 endpoint | OpenCode 能力 | 缺的 Cradle owner/kit | 建议 |
|------|------|------|------|
| `/api/session/{sessionID}/compact` | native session compaction | provider compaction command/hook | 需要新增 `compactSession` 或 runtime command action；现在只有 compact UI state 类型，没有 provider method |
| `/api/session/{sessionID}/revert/stage|clear|commit` | stage/commit/clear revert, potentially workspace file rollback | rollback contract 只允许 `fileChangesReverted: false` | 扩展 rollback kit，区分 conversation revert 与 file revert/staged revert；否则不要接 commit 类动作 |
| `/api/fs/read`、`/api/fs/list`、`/api/fs/find` | provider-scoped filesystem read/search | runtime filesystem/reference provider | Cradle 已有 workspace fs routes，但没有“runtime native fs/reference source”kit；可先用于 read-only mention/search，不要绕过 Cradle workspace ownership 写文件 |
| `/api/reference` | native reference suggestions | composer mention/reference kit | 需要统一 reference provider contract，才能把 OpenCode references 接入 composer/side panel |
| `/api/agent` | supported OpenCode agents，可作为 composer `@agent` 提及/选择 catalog | runtime agent catalog/selector | 不应进入 crew slot；若要展示/选择，需要新增 agent catalog/agent picker kit |
| `/api/integration/*`、`/api/credential/*` | OpenCode integrations and credentials | runtime integration/auth flow + credential ownership | 需要先定 Cradle 是否拥有 OpenCode isolated credential lifecycle；不要直接把 OpenCode credential mutation 塞进 generic provider target |
| `/experimental/project/{projectID}/copy*` | OpenCode project copy | workspace/project-copy ownership | 和 Cradle workspace/worktree 语义重叠，需产品决策；不应默认接到 ChatRuntime |
| `/api/event` v2 | v2 event stream with `session.next.*`, question/permission v2 events | adapter-internal projector, no new generic kit | ✅ active turn 已通过持续 event pump 消费 v2 event stream；`session.next.*` 与 root `message.*` 双事件族并存，question/permission v2 bridge 继续复用现有 Chat Runtime kit |

### 当前不建议接入 ChatRuntime 的 v2 能力

- `/api/integration/*`、`/api/credential/*` 在没有 Cradle-owned credential lifecycle 前不应直接暴露给 runtime UI。
- `/experimental/project/{projectID}/copy*` 和 Cradle workspace/worktree 能力重叠，先不要用 provider 私有项目副本替代 Cradle workspace。
- `/api/fs/*` 只适合 read/search/reference；写入仍应走 agent tool execution 或 Cradle workspace APIs，避免绕开文件变更审计和 diff UI。
- `/api/agent` 是“支持哪些 agent”的 catalog，不是当前 session 已创建的 subagent/crew 状态。

## 参考实现

### Claude Agent Provider

| 方法 | 文件 |
|------|------|
| `generateSessionTitle` | `provider.ts:1015-1050` |
| `getPresentation` | `provider.ts:258-277` |
| `getUiSlotStates` | `provider.ts:279-303` |
| btw slot 定义 | `metadata.ts:39-102` |
| slash commands 映射 | `metadata.ts:104-118` |

### Codex Provider

| 方法 | 文件 |
|------|------|
| `generateSessionTitle` | `provider.ts:1780-1819` |
| `getPresentation` / `getDraftPresentation` | `provider.ts:544-550` |
| `getUiSlotStates` | `provider.ts:584+` |
| UI slot 定义 | `projection/ui-slot-projector.ts` |
