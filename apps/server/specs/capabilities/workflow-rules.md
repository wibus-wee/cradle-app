# Capability: Workflow Rules

## Superpowers Used

- Leader Agent: writing-plans, subagent-driven-development
- Legacy Behavior Explorer Sub Agent: Explore (workflow-rules filesystem behavior)
- Architecture Explorer Sub Agent: Explore (Tsuki module boundaries)

## User / System Goal

- 系统需要为每个 workspace 保存一份全局 workflow rule，以及若干 Agent Identity 级别的覆盖规则。
- 规则属于 Cradle server 自己的数据，不再写入旧桌面态 `~/.cradle/workflows` 兼容路径。
- HTTP client 需要稳定的 CRUD 接口来读取、保存、删除并列出某个 workspace 下的规则。

## Current Behavior Evidence

- 旧实现提供 `get/save/delete/list` 四个操作。
- 规则存储为 Markdown 文本，global 固定为 `rules.md`，agent-specific 固定为 `agents/<agentId>.md`。
- 旧实现对 workspaceId / agentId 做路径穿越保护，非法 ID 直接抛错。
- 缺失文件时读取返回 `null`，删除为幂等。

## Inputs / Outputs

- `get(workspaceId, agentId?)` → `{ global: string | null, agentSpecific: string | null }`
- `save(workspaceId, agentId | null, content)` → `{ ok: true }`
- `delete(workspaceId, agentId | null)` → `{ ok: true }`
- `list(workspaceId)` → `Array<{ type: 'global' | 'agent', agentId: string | null, content: string }>`

## Side Effects

- 读写 `CRADLE_DATA_DIR/workflow-rules/<workspaceId>/...` 下的 Markdown 文件。
- 自动创建缺失目录。

## Dependencies

- `ServerConfig`（定位 `dataDir`）
- Node `fs/promises`, `path`
- `AppError`（输入错误归一）

## Target API

- `GET /workflow-rules/:workspaceId?agentId=` → `WorkflowRules`
- `GET /workflow-rules/:workspaceId/list` → `WorkflowRuleEntry[]`
- `PUT /workflow-rules/:workspaceId` `{ agentId?: string | null, content: string }` → `{ ok: true }`
- `DELETE /workflow-rules/:workspaceId?agentId=` → `{ ok: true }`

错误约定：

- 非法 workspaceId / agentId → `invalid_workflow_rule_id`, HTTP 400
- 缺失 content → `invalid_workflow_rule_input`, HTTP 400

## Target Module Design

- `WorkflowRulesModule`
  - `WorkflowRulesController`: HTTP API
  - `WorkflowRulesService`: capability semantics
  - `WorkflowRulesStore`: filesystem read/write and path ownership
  - `WorkflowRulesConfig`: own storage root under server data dir

## Compatibility Requirements

- 保留旧的读取语义（缺失返回 null，删除幂等）。
- 不实现旧 `~/.cradle/workflows` 兼容层；新架构只写 server 自己的数据目录。

## Test Plan

- 保存/读取/列出/删除 global 与 agent-specific 规则。
- 缺失 workspace 返回 null/空列表。
- 非法 ID 返回 400。
- 文件实际写入 `CRADLE_DATA_DIR/workflow-rules`。
