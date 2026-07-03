# Capability: Session

## Superpowers Used

- Leader Agent: using-superpowers, brainstorming, writing-plans, subagent-driven-development
- Architecture Explorer Sub Agent: Explore (Tsuki/Hono module constraints)
- Legacy Behavior Explorer Sub Agent: Explore (session IPC behavior + renderer usage)
- Dependency / Side Effect Explorer Sub Agent: Explore (DB schema + search/pty side effects)
- Capability SPEC Writer Sub Agent: Leader Agent (this document)

## Spawned Sub Agents

| Agent                    | Scope                               | Output                                           | Status  |
| ------------------------ | ----------------------------------- | ------------------------------------------------ | ------- |
| Architecture Explorer    | Tsuki/Hono module constraints       | Module layout notes for controller/service/store | ✅ Done |
| Legacy Behavior Explorer | SessionService IPC behavior + tests | CRUD + export markdown behavior                  | ✅ Done |
| Dependency Explorer      | DB schema + search/pty dependencies | Side effect map + dependency list                | ✅ Done |

## User / System Goal

- 系统维护聊天会话元数据（workspace、title、providerTargetId、agentId、pinned 等），支持列表、读取、创建、更新、删除。
- UI 需要读取会话元数据，并支持导出为 Markdown。历史消息 hydration 由 Chat Runtime capability 提供。

## Current Behavior Evidence

- IPC `SessionService` 支持 `list/get/create/delete/updateTitle/togglePin/exportAsMarkdown`。
- `delete` 会停止当前会话的 PTY，并移除该会话的搜索索引（FTS）。
- `exportAsMarkdown` 读取 session + messages + backend session binding，assistant 文本直接来自 `messages.content` 派生缓存。

## Inputs / Outputs

### CRUD

- `list(workspaceId)` → `Session[]`（按 `updatedAt` 倒序）
- `get(id)` → `Session`（不存在时返回 `session_not_found` / 404）
- `create({ workspaceId?, title, providerTargetId?, agentId?, runtimeKind?, id? })` → `Session`
- `update({ id, title?, pinned? })` → `Session`（不存在时返回 `session_not_found` / 404；非 title 字段更新 `updatedAt`；title 通过 Chat Runtime `TitleChanged` 事件投影）
- `delete(id)` → `{ ok: true }`

Create-time note:

- 标准 chat session 可通过 `providerTargetId` 或 `agentId` 创建。
- `runtimeKind === 'cli-tui'` 的 session 必须通过 `agentId` 创建，由 agent/session runtime config owner 提供 launch meaning。

### Export

- `exportAsMarkdown(sessionId)` → `string`
  - Header: `# {title}`
  - Meta: `> Model: {requestedModelId|unknown} | Created: {local time}`
  - 每条消息按 `## User/Assistant` 分段
  - Assistant 文本从 `messages.content` 派生缓存读取

## Side Effects

- 删除会话时触发 PTY 停止和搜索索引清理。
- 清理回调由 session capability 统一编排，当前已接入 PTY 与 search capability。

## Dependencies

- `@cradle/db`：`sessions` / `messages` / `backend_session_bindings` / `backend_runs`。
- `DbAccessor`（服务器 DB 访问）。
- 搜索索引（thread search）与 PTY 能力（若已迁移，作为可选依赖）。

## Domain Model

```ts
type Session = {
  id: string
  workspaceId: string
  title: string
  providerTargetId: string | null
  agentId: string | null
  linkedIssueId: string | null
  pinned: number
  createdAt: number
  updatedAt: number
}

type Message = {
  id: string
  sessionId: string
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  content: string
  messageJson: string
  errorText: string | null
  createdAt: number
  updatedAt: number
}
```

## Target API

HTTP endpoints (Tsuki/Hono controller):

- `GET /sessions?workspaceId=` → `Session[]`
- `GET /sessions/:id` → `Session`（不存在时返回 `session_not_found` / 404）
- `POST /sessions` `{ workspaceId, title, providerTargetId?, agentId?, runtimeKind?, modelId?, id? }` → `Session`
- `PATCH /sessions/:id` `{ title?, pinned? }` → `Session`
- `DELETE /sessions/:id` → `{ ok: true }`
- `GET /sessions/:id/export/markdown` → `{ markdown: string }`

Chat transcript hydration is exposed by Chat Runtime as `GET /chat/sessions/:sessionId/messages`.

错误约定：

- 输入缺失/非法 → `AppError` (HTTP 400)
- `GET /sessions/:id`、`PATCH /sessions/:id` 不存在 → `session_not_found` / 404
- 列表和搜索型读取在无结果时返回空列表

## Target Module Design

- `SessionModule`
  - `SessionController`: HTTP endpoints
  - `SessionService`: 业务语义 + side effects
  - `SessionStore`: DB 访问
  - `SessionExport`: Markdown 导出与 `messages.content` 纯文本读取

## Events

- 本能力不引入事件发布/订阅（后续 search/pty capability 可接入）。
- Session 自身不定义新的事件流；用户 title 更新复用 Chat Runtime `TitleChanged` 事件，以保证 session title 只有一个落库路径。

## Compatibility Requirements

- 保持旧 IPC 语义：排序、返回 `null`/空列表、Markdown 结构。
- 删除会话时尝试清理 PTY 与搜索索引（若 capability 已可用）。

## Test Plan

- CRUD：创建/更新/删除/列表/读取。
- `PATCH /sessions/:id`：支持 title / pinned 的资源字段更新。
- `getMessages`：按时间升序返回。
- `exportAsMarkdown`：包含标题、模型信息与消息内容，assistant 文本来自 `messages.content`。
- 删除时调用 PTY/搜索清理（可用时）。

## Cutover Plan

- 新 server capability 通过 HTTP 暴露 session 能力后，客户端逐步迁移到新 API。
- 旧 IPC 入口保留到新 API 完成切换后再移除。
