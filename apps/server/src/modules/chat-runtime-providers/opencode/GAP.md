# opencode Provider 能力差距分析

> Cradle `OpencodeProvider` 当前实现 vs opencode SDK 原生能力之间的差距。

## 总览

| 类别 | Opencode SDK 能力 | Cradle 实现 | 优先级 |
|------|:-:|:-:|:-:|
| Title 生成 | `small_model` config、`session.summarize()`、`session.get()`、`session.update()` | ✅ 已实现 | 高 |
| Slash Commands | `command` config、`client.command.list()`、`session.command()` | ✅ 已实现列表投影与 `/command` 路由 | 高 |
| Shell 执行 | `session.shell()` | ✅ `supportsShellExecution: true` | 高 |
| 呈现能力 (Presentation) | command/slot 系统 | ✅ 已实现 `getPresentation`/`getDraftPresentation` | 高 |
| Event-first Turn | `event.subscribe()` + `session.promptAsync()` | ✅ 普通 prompt 已改为 SSE-first；订阅失败才 fallback 到 `session.prompt()` | 高 |
| Permission Approval | `permission.updated` + `postSessionIdPermissionsPermissionId()` | ✅ 已接入 Chat Runtime pending tool approval | 高 |
| File/Image 输入 | `FilePartInput` | ✅ AI SDK file part 会投影为 opencode file part | 高 |
| Plugin MCP 配置 | `Config.mcp` local/remote servers | ✅ Cradle plugin registry 会投影为 OpenCode `config.mcp[...]` | 高 |
| MCP 生命周期管理 | `mcp.add/connect/disconnect/auth.*` | ⏸ 只接入插件配置与 `mcp.status()` 状态；未提供 Cradle UI/route 管理 OpenCode MCP 生命周期 | 中 |
| Provider Threads / Fork | `session.list/get/messages/delete/fork()` | ✅ 已接入 Chat Runtime provider-thread 与 side-chat fork hooks | 中 |
| UI Slot 状态 | `session.status()`、`session.todo()`、`session.diff()`、`mcp.status()`、`file.status()`、`app.agents()`、permission lifecycle | ✅ 已实现 status/model/progress/diff/approvals/MCP/filesystem/agents 状态；step/compact 仍走 stream evidence | 中 |
| Provider Thread Metadata | `session.share`、`session.summary`、`session.revert`、`session.children()` | ✅ provider-thread source/threadSource 包含 shareUrl、summary、revert、childCount | 中 |
| Steer Turn | `session.revert()` / `session.unrevert()` | ⏸ 未声明；Chat Runtime hook 是 live-turn steer，opencode 当前无等价 active-turn API | 中 |
| 回滚 (Rollback) | `session.messages()` + `session.revert()` | ✅ `supportsLastTurnRollback: true` | 中 |
| btw / Quick Question | SDK 无原生 no-history 概念 | ✅ 临时 opencode session + transcript prompt，不写 Cradle 历史 | 中 |
| Structured User Input | SDK 1.17.11 无 `question.*` event/reply endpoint | ⏸ 不实现假桥；等待 SDK 暴露真实 primitive 后接入 Chat Runtime `requestUserInput` | 中 |
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
3. `streamTurn` 识别已注册 `/command` 文本并路由到 `session.command()`；未匹配的普通 prompt 在 SSE 可用时走 `session.promptAsync()`，SSE 订阅失败时 fallback 到 `session.prompt()`

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
- 普通 prompt 先订阅 `event.subscribe()`，再读取当前 session 已有 message id 作为 baseline，然后调用不带自定义 `messageID` 的 `session.promptAsync()`。
- adapter 用“不在 baseline 中的新 assistant message”识别当前 turn 的终态 message；终态时再读 `session.message()` 补偿 missed parts，然后发 AI SDK `finish`。projector 也会忽略 baseline 内的旧 message，避免第二轮复用 session 时重放上一轮文本。
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

### 8. Plugin MCP 配置与生命周期

**SDK 可用资源**:
- Config 字段 `mcp`:
  - local MCP: `{ type: "local", command: string[], environment?, enabled? }`
  - remote MCP: `{ type: "remote", url: string, headers?, oauth?, enabled? }`
- API: `mcp.status()` — 读取当前 workspace directory 下 MCP server 状态
- API: `mcp.add()`、`mcp.connect()`、`mcp.disconnect()`、`mcp.auth.start()`、`mcp.auth.callback()`、`mcp.auth.authenticate()`、`mcp.auth.remove()` — OpenCode 原生 MCP server 生命周期与 OAuth 管理

**Cradle 接口**: Cradle 插件系统通过 `apps/server/src/plugins/mcp-registry.ts` 注册插件提供的 MCP server。Claude Agent 和 Codex provider 已经消费该 registry；OpenCode provider 现在也通过 `config.ts` 将同一 registry 投影成 OpenCode `Config.mcp`，并由 `runtime-context.ts` 通过 `OPENCODE_CONFIG_CONTENT` 注入共享 OpenCode server 的启动配置。Cradle 同时把 OpenCode `cwd`、`OPENCODE_CONFIG_DIR`、`OPENCODE_DB` 隔离到 `CRADLE_DATA_DIR/runtime/opencode`，并设置 `OPENCODE_DISABLE_PROJECT_CONFIG=1`，避免在 active workspace directory 写入项目级 `config.json` 或复用用户全局 OpenCode DB。

**当前状态**: 插件 MCP 已接入。stdio 插件 server 会投影为 OpenCode local MCP，command 为 `[command, ...args]`，env 会投影到 `environment`；streamable HTTP 插件 server 会投影为 OpenCode remote MCP，url 和 headers 会投影到 `url`/`headers`。`getUiSlotStates()` 仍通过 `mcp.status()` 读取状态。尚未实现的是面向用户的 Cradle MCP lifecycle UI/route：用户还不能在 Cradle 内对 OpenCode 调用 `mcp.add/connect/disconnect/auth.*`。

### 9. UI Slot 状态

**SDK 可用资源**: `session.status()`、`session.todo()`、`session.diff()`，以及事件流中的 `agent`、`subtask`、`step-start`、`step-finish`、`compaction` 等事件。

**Cradle 接口**: `getUiSlotStates?(input): Promise<RuntimeUiSlotState[]>`

**当前状态**: 已实现 status/model/progress/diff/approvals/MCP/filesystem/agents 这类可直接读取或由 permission bridge 明确维护的状态。MCP 通过 `mcp.status()` 投影为 Cradle `mcp` slot；文件状态通过 `file.status()` 投影为 `filesystem` slot；OpenCode native agents 通过 `app.agents()` 投影为 `crew` slot。step/compact 等 provider 事件仍以 `data-runtime-event` 形式进入 stream evidence，不在 polled slot state 中猜测生命周期。

### 10. Steer Turn / Rollback

**SDK 可用资源**:
- `session.revert()` — POST `/session/{id}/revert`
- `session.unrevert()` — POST `/session/{id}/unrevert`

**Cradle 接口**:
- `steerTurn?(input): Promise<void>`
- `rollbackLastTurn?(input): Promise<RollbackLastTurnResult>`

**当前状态**:
- `rollbackLastTurn()` 已实现：读取最近 assistant message 后调用 `session.revert()`，不回滚工作区文件。
- `steerTurn` 未声明：Cradle 当前 hook 面向 active turn live steering，opencode v1 SDK 暴露的是 session revert/unrevert primitive，不具备同等语义。

### 11. Structured User Input

**SDK 可用资源**: 在 `@opencode-ai/sdk@1.17.11` 中没有 `question.*` event，也没有 question reply endpoint。该 SDK 的事件 union 包括 message、permission、session、file watcher、VCS、TUI、PTY、server 等事件，但不包括结构化用户提问。

**Cradle 接口**: Chat Runtime 已有 `ProviderContext.requestUserInput`、pending user-input registry、`/chat/sessions/:sessionId/user-input/:requestId` route 和 web composer/runtime-panel UI。

**当前状态**: 不实现 OpenCode question bridge。等 OpenCode SDK 暴露真实 question primitive 后，应复用 Cradle 的通用 `requestUserInput` contract，而不是新增 OpenCode 私有前端通道。

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
