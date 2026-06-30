# Capability: Profiles

## User / System Goal

- 系统需要保留 `/profiles` API 作为 manual provider target 的投影接口。
- profile 是用户可选的运行时配置单元，实际持久化 owner 是 `provider_targets(kind = 'manual')`，负责承载 `providerKind`、`connectionConfigJson`、`credentialRef`。
- 删除 profile 时，server 必须删除对应 provider target，并让 provider target owner 清理 runtime binding、session 与相关审计数据。

## Current Behavior Evidence

- 旧 agent runtime 暴露 profile CRUD；发布 baseline 后 profile 不再有独立数据表。
- session 与 runtime 审计数据通过 `providerTargetId` 关联 provider target。
- 用户在设置页、新建聊天、issue agent 等流程里都依赖稳定的 provider target id。

## Target API

- `GET /profiles` → 列出全部 profile
- `GET /profiles/:id` → 获取单个 profile
- `PUT /profiles/:id` → 创建或更新 profile
- `DELETE /profiles/:id` → 删除 profile，并清理其 session / 审计从属数据

## Target Module Design

- `ProfilesModule`
  - `ProfilesController`: HTTP 参数校验与错误边界
  - `ProfilesService`: profile API 到 manual provider target 生命周期的投影
  - `ProviderTargetsService`: `provider_targets` 持久化与 provider-target-owned cleanup

## Test Plan

- CRUD 返回结构稳定。
- 删除 profile 后，其 session 与 runtime 审计数据一并清理。
- 缺失字段、非法 provider kind 返回结构化错误。
