# Capability: Agent Identity

## Superpowers Used

- Leader Agent: using-superpowers, writing-plans, subagent-driven-development
- Legacy Behavior Explorer Sub Agent: Explore (legacy AgentService IPC behavior)
- Dependency Explorer Sub Agent: Explore (identity schema + FK constraints)

## User / System Goal

- 系统需要维护可供会话与运行时绑定的 Agent 实体（名称、头像、provider target 关联、模型与思考强度）。
- UI 需要稳定的 Agent CRUD HTTP 接口，替代旧 IPC `agent` service。
- HTTP server 需要提供基础过滤能力，避免客户端永远拉全量后再自行筛选。

## Current Behavior Evidence

- 旧 IPC `AgentService` 提供 `list/get/create/update/remove`。
- `create` 使用 `avatarStyle + avatarSeed` 生成 DiceBear `avatarUrl`。
- `update` 在 `avatarStyle/avatarSeed` 变更时重算 `avatarUrl`。
- `update` 是 partial patch；未提供的字段保持不变。
- 旧 IPC `list()` 返回全量，调用方通常再按 `enabled` 或 provider target 做前端过滤。
- `providerTargetId` 关联 `provider_targets.id`，非法 provider target 由 DB 约束拒绝。

## Inputs / Outputs

### CRUD

- `list(filters?)` → `Agent[]`
- `get(id)` → `Agent | null`
- `create(input)` → `Agent`
- `update(id, patch)` → `Agent | null`
- `delete(id)` → `{ ok: true }`

### Filters

- `enabled?: boolean` → 仅返回启用/禁用 Agent
- `providerTargetId?: string` → 仅返回绑定到指定 provider target 的 Agent

## Dependencies

- `@cradle/db`：`agents` / `provider_targets`。
- `DbAccessor`（server DB 访问）。
- `AppError`（输入校验和错误归一）。

## Target API

- `GET /agents?enabled=&providerTargetId=` → `Agent[]`
- `GET /agents/:id` → `Agent | null`
- `POST /agents` → `Agent`
- `PATCH /agents/:id` → `Agent | null`
- `DELETE /agents/:id` → `{ ok: true }`

错误约定：

- 输入缺失/非法：`AppError`（`invalid_agent_input`, HTTP 400）
- `providerTargetId` 非法或不存在：`AppError`（`provider_target_not_found`, HTTP 400）
- 资源不存在：`get/update` 返回 `null`

## Target Module Design

- `apps/server/src/modules/agent-identity/agent-identity.module.ts`
- `agent-identity.controller.ts`: HTTP API + query/body validation
- `agent-identity.service.ts`: capability semantics + avatar URL rebuild policy + filter parsing
- `agent-identity.store.ts`: Drizzle CRUD + filtered list query

## Compatibility Requirements

- 保持关键语义一致：默认值、头像 URL 生成规则、`update` 局部更新行为。
- `avatarUrl` 由服务端策略生成，不接受客户端自定义覆盖。
- 本阶段仅 HTTP server；不做 Electron IPC 兼容层。

## Test Plan

- CRUD：创建、读取、更新、删除、列表。
- 头像规则：创建生成 URL；更新 style/seed 后 URL 变化。
- 过滤：`enabled` / `providerTargetId` query 生效。
- 输入校验：缺失必填字段返回 400 + `invalid_agent_input`。
- 非法 providerTargetId 返回 400 + `provider_target_not_found`。
- 不存在资源：`GET/PATCH` 返回 `null`。
