# Capability: Health

## User / System Goal

- 提供一个最小但稳定的 HTTP 健康检查端点，用于本地开发、部署探针与 smoke test。

## Current Behavior Evidence

- `GET /health` 返回 `{ status: 'ok', timestamp }`。
- 当前实现不依赖数据库或其他 capability 成功初始化。

## Target Module Design

- `HealthModule`
  - `HealthController`: 只负责心跳响应

## Test Plan

- 请求 `GET /health` 返回 200。
- 返回体包含 `status: 'ok'` 与数值型 `timestamp`。
