# opencode Provider 能力差距分析

> Cradle `OpencodeProvider` 当前实现 vs opencode SDK 原生能力之间的差距。

## 总览

| 类别 | Opencode SDK 能力 | Cradle 实现 | 优先级 |
|------|:-:|:-:|:-:|
| Title 生成 | `small_model` config、`agent.title` (v2)、`session.summarize()`、`session.update()` | ❌ 未实现 | 高 |
| Slash Commands | `command` config、`client.command.list()`、`session.command()` | ❌ 未实现 | 高 |
| Shell 执行 | `session.shell()` | ❌ `supportsShellExecution: false` | 高 |
| 呈现能力 (Presentation) | 完整的 command/slot 系统 | ❌ 未实现 `getPresentation`/`getDraftPresentation` | 高 |
| UI Slot 状态 | 流式事件含 step/agent/compact 等 | ❌ 未实现 `getUiSlotStates` | 中 |
| Steer Turn | `session.revert()` / `session.unrevert()` | ❌ `supportsSteerTurn: false` | 中 |
| 回滚 (Rollback) | `session.revert()` | ❌ `supportsLastTurnRollback: false` | 中 |
| btw / Quick Question | SDK 无原生概念，但可通过 `session.command()` 实现 | ❌ 未实现 | 中 |
| Skills | `skill` 系统、`SkillV2Info.slash` | ❌ 未读取 | 低 |
| Runtime 设置 | SDK 支持 mode/agent 切换 | ❌ `supportsRuntimeSettings: false` | 低 |

## 详细分析

### 1. Title 生成

**SDK 可用资源**:
- Config: `small_model` — 专门为 title 等轻量任务指定模型
- Config (v2): `agent.title` — 专用于 title 生成的 agent 配置
- API: `session.summarize({ providerID, modelID })` — POST `/session/{id}/summarize`
- API: `session.update({ title })` — PATCH `/session/{id}` 直接设置标题

**Cradle 接口**: `ChatRuntime.generateSessionTitle(input: GenerateSessionTitleInput): Promise<string | null>`

**实现方案**: 利用 `small_model` 或主模型，调用 `session.summarize()` 获取建议标题，再通过 `session.update()` 设置。

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

**实现方案**: 
1. 从 `Config.command` 和 `client.command.list()` 读取命令列表
2. 映射为 `RuntimeSlashCommand[]` 通过 `getPresentation` 暴露
3. 将 `session.command()` 路由到对应的 prompt/command 流程

### 3. btw / Quick Question

**概念**: Cradle 的 "btw" 是一种不记入历史记录的快速提问模式，在 Claude Agent 中实现为 `RuntimeUiSlot`:
```ts
{ name: 'btw', commandText: '/btw ', surfaces: ['slashCommand', 'composerState'] }
```

**SDK 对应**: opencode SDK **没有**直接对应的概念。但可通过以下方式实现：
- `session.command()` — 作为一个自定义 command 实现
- 或者通过一个轻量 prompt + 不持久化消息的方式

**Cradle 接口**: `ChatRuntime.quickQuestion?()`

### 4. Shell 执行

**SDK 可用资源**:
- API: `session.shell({ body: { command } })` — POST `/session/{id}/shell`

**Cradle 接口**: `ChatRuntime.executeShellCommand?(input): Promise<ExecuteShellCommandResult>`

**当前状态**: `supportsShellExecution: false`，需要改为 `true` 并实现 `executeShellCommand`。

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

**当前状态**: 完全未实现。前端无法获取任何 slash commands 或 UI slots。

### 6. UI Slot 状态

**SDK 可用资源**: 事件流中的 `agent`、`subtask`、`step-start`、`step-finish`、`compaction` 等事件。

**Cradle 接口**: `getUiSlotStates?(input): Promise<RuntimeUiSlotState[]>`

**当前状态**: 未实现。前端无法显示 usage、compact 等状态。

### 7. Steer Turn / Rollback

**SDK 可用资源**:
- `session.revert()` — POST `/session/{id}/revert`
- `session.unrevert()` — POST `/session/{id}/unrevert`

**Cradle 接口**:
- `steerTurn?(input): Promise<void>`
- `rollbackLastTurn?(input): Promise<RollbackLastTurnResult>`

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
