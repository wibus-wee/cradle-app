# Capability: Observability

## User / System Goal

- 系统需要把关键运行时异常记录为 canonical observability event，并按规则聚合为 incident。
- server-first 版本聚焦 HTTP 查询/导出能力，不迁移 Electron devtool window 与 renderer push 通道。
- 第一阶段必须覆盖 chat-runtime 的高价值故障：`CHAT_EMPTY_OUTPUT_COMPLETION` 与 `TURN_STREAM_FAILED`。

## Current Behavior Evidence

- 旧 `observability/service.ts` 提供 canonical event 记录、incident 规则投影、flush/shutdown 与 bundle 导出。
- 旧 `chat-turn-executor.ts` 会把“provider 完成但没有任何 assistant/tool 输出”标准化为失败并记录 `CHAT_EMPTY_OUTPUT_COMPLETION`。
- 共享 schema `packages/db/src/schema/observability.ts` 与 migration 已存在，可直接被 server 复用。
- 旧 renderer/devtool 依赖的是查询/导出语义，不要求 Electron 才能成立。

## Target API (Slice 1)

- `GET /observability/events`
- `GET /observability/incidents`
- `POST /observability/flush`
- `GET /observability/export`

## Target Module Design

- `ObservabilityModule`
  - `ObservabilityController`: HTTP query parsing、flush、bundle export
  - `ObservabilityService`: canonical event owner，负责 dedupe key、recent window、incident projection
  - `ObservabilityStore`: append-only event queue + incident upsert/query
  - `exporter.ts`: 组装 event / incident / timeline 调试包
  - `sink.ts`: 给业务模块注入的最小观测端口
- `ChatRuntimeService` 直接注入 `ObservabilityService`，记录：
  - stream 异常 -> `TURN_STREAM_FAILED`
  - provider completed 但无 assistant/reasoning/tool output -> `CHAT_EMPTY_OUTPUT_COMPLETION`
- 第一阶段不实现 WebSocket/SSE push，不迁移 devtool buffer；HTTP 查询即为 server 所有者接口。

## Test Plan

- provider 空输出完成会把 assistant message 标记为 `failed`，并写入 `CHAT_EMPTY_OUTPUT_COMPLETION` event。
- 同一 dedupe key 在 5 分钟内累计 3 次空输出后，会产生 1 条 open incident。
- provider stream 直接失败时，会写入 `TURN_STREAM_FAILED` event 与 incident。
- export bundle 能按 `chatSessionId` / `runId` 返回事件、incident、关联 timeline。