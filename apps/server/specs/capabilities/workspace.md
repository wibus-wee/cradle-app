# Capability: Workspace

## Superpowers Used

- Leader Agent: using-superpowers, brainstorming, writing-plans, subagent-driven-development
- Architecture Explorer Sub Agent: Explore (Tsuki/Hono module constraints)
- Legacy Behavior Explorer Sub Agent: Explore (workspace behavior + renderer/IPC usage)
- Dependency / Side Effect Explorer Sub Agent: Explore (schema + filesystem + risks)
- Capability SPEC Writer Sub Agent: Leader Agent (this document)

## Spawned Sub Agents

| Agent | Scope | Output | Status |
| --- | --- | --- | --- |
| Architecture Explorer | Tsuki/Hono module constraints | Constraints + module layout guidance | ✅ Done |
| Legacy Behavior Explorer | workspace feature + IPC + renderer usage | Behavior map + in/out semantics | ✅ Done |
| Dependency Explorer | DB schema + filesystem + safety | Dependency & risk notes | ✅ Done |

## User / System Goal

- 系统需要维护一组“工作区”记录（名称、路径、创建/更新时间），并且为 UI 提供安全的文件列表与文本读写能力（例如读取/保存 `AGENTS.md`）。
- 用户希望能快速把本地目录注册为工作区，并在 UI 中看到工作区列表与文件树。

## Current Behavior Evidence

- 旧实现提供 workspace CRUD 与 `addFromDirectory`（默认 name=basename），并支持 `resolveByPath`。
- 文件列表读取根目录 `.gitignore`，并强制忽略 `node_modules/.git/.DS_Store`，返回相对路径与类型。
- 文本读写对越界路径返回 `null/false`，避免穿越 workspace 根目录。
- Electron 侧 IPC 负责目录选择与 shell 打开路径，属于平台层能力。

## Inputs / Outputs

### CRUD

- `list()` → `Workspace[]`
- `get(id)` → `Workspace | null`
- `resolveByPath(path)` → `Workspace | null`
- `addFromDirectory(path)` → `Workspace`
- `create({ name, path })` → `Workspace`
- `update({ id, name })` → `Workspace | null`
- `delete(id)` → `{ ok: true }`

### File Operations

- `listFiles(workspaceId)` → `WorkspaceFileEntry[]`（workspace 不存在时返回 `[]`）
- `readTextFile(workspaceId, relativePath)` → `{ content: string | null }`
- `writeTextFile(workspaceId, relativePath, content)` → `{ success: boolean, ownerBoundary }`

## Side Effects

- 写入 SQLite：创建/更新/删除 workspace 记录。
- 读取/写入磁盘：遍历 workspace 文件、读取/写入指定文本文件。

## Dependencies

- `@cradle/db` 的 `workspaces` 表（`path` 唯一约束）。
- `fast-glob` 与 `ignore`（`.gitignore` 过滤）。
- Node `fs/promises` + `path`（安全路径解析）。
- `DbAccessor`（数据库访问）。

## Domain Model

```ts
type Workspace = {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

type WorkspaceFileEntry = {
  type: 'file' | 'directory'
  name: string
  path: string
}
```

## Target API

HTTP 端点（Tsuki/Hono controller）：

- `GET /workspaces` → `Workspace[]`
- `GET /workspaces/:id` → `Workspace | null`
- `GET /workspaces/resolve?path=` → `Workspace | null`
- `POST /workspaces` `{ name, path }` → `Workspace`
- `POST /workspaces/from-directory` `{ path }` → `Workspace`（name=basename）
- `PATCH /workspaces/:id` `{ name }` → `Workspace | null`
- `DELETE /workspaces/:id` → `{ ok: true }`
- `GET /workspaces/:id/files` → `WorkspaceFileEntry[]`
- `GET /workspaces/:id/files/content?path=` → `{ content: string | null }`
- `PUT /workspaces/:id/files/content` `{ path, content, confirmedNonCradleOwnedWrite: true }` → `{ success: boolean, ownerBoundary }`

错误约定：

- 重复 `path` 的创建返回 `AppError`（`workspace_path_exists`, HTTP 409）。
- 输入缺失/非法返回 `AppError`（HTTP 400）。
- 写 workspace file 是 non-Cradle-owned write。请求必须携带 `confirmedNonCradleOwnedWrite: true`，否则返回 `non_cradle_owned_write_confirmation_required`（HTTP 400），并且不写入文件。
- 成功或路径被安全策略阻止时，响应都会包含 `ownerBoundary`，其中 `classification` 为 `non-cradle-owned`，`owner` 为 `workspace`，并包含 `workspacePath`、`relativePath` 和 resolved `targetPath`。

## Target Module Design

- `WorkspaceModule`
  - `WorkspaceController`：暴露 HTTP endpoints。
  - `WorkspaceService`：业务语义（CRUD + 文件能力）。
  - `WorkspaceStore`：DB 读写。
  - `WorkspaceFiles`：`.gitignore` 过滤与安全 IO。

## Events

- 本能力不引入事件发布/订阅（后续需要时再补）。

## Compatibility Requirements

- 不包含 Electron 目录选择器与 shell 打开路径能力（由客户端自行实现）。
- 保持旧语义：`listFiles` 对不存在 workspace 返回 `[]`，`readTextFile` 返回 `null`，`writeTextFile` 返回 `success: false`。
- 写入 route 的兼容性变化是有意的：调用方必须显式确认 non-Cradle-owned workspace write，以满足 namespace ownership 规则。

## Test Plan

- 通过 `createConfiguredApp()` 验证 `/workspaces` CRUD 与 `resolveByPath`。
- 验证 `listFiles` 遵守 `.gitignore` 与默认忽略规则。
- 验证 `readTextFile`/`writeTextFile` 的越界保护与成功写入。
- 验证缺少或拒绝 `confirmedNonCradleOwnedWrite` 时返回 400，且目标文件内容保持不变。
- 验证重复路径创建返回 409（若实现该约束）。

## Cutover Plan

- 新 server capability 通过 HTTP 暴露 workspace 能力后，客户端逐步迁移到新 API。
- 旧 IPC/shell 能力保持在客户端层，不在 server capability 内实现。
