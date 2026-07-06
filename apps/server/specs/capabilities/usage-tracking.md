# Capability: Usage Tracking

## User / System Goal

- 系统需要从 `usage_logs` 中提供按日、按 session、按 agent/model 聚合的 token usage 统计。
- UI 需要 Usage Dashboard 所需的 summary、daily usage、streak/stats 等 HTTP 接口。

## Current Behavior Evidence

- HTTP `UsageModule` 提供 `getDailyUsage/getUsageSummary/getUsageStats/getSessionUsage` 及 cost 端点。
- **写入路径**：`turn-executor` 在 run finalize 时调用 `insertRunUsage` → `usage_logs`（每 completed、非 cancel 的 run 一行）。数值来自 `ChatRuntime.totalUsage ?? lastUsage`。
- **权威字段契约**：见 `plans/025-usage-authoritative-fields.md`（各 provider 应从 SDK/app-server 原样取用 turn-final usage，不在 Dashboard 层自行汇总）。
- 本 capability 的 service 层是读模型查询；cost 由 `usage_logs` token × 当前价目表即时计算。

## Target API

- `GET /usage/daily?days=` → `DailyUsage[]`
- `GET /usage/summary` → `UsageSummary`
- `GET /usage/stats` → `{ currentStreak, longestStreak, activeDays, avgDailyTokens, peakDay, todayTokens }`
- `GET /usage/sessions/:sessionId` → `{ totalTokens, promptTokens, completionTokens, count }`

## Target Module Design

- `UsageModule`
  - `UsageController`: HTTP API
  - `UsageService`: analytics queries and streak calculation

## Test Plan

- 对 seeded `usage_logs` 校验 daily aggregation、summary、stats、session totals。
- `days` query 缺省为 365，非法值返回 400。
