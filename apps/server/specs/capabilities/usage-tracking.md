# Capability: Usage Tracking

## User / System Goal

- 系统需要从 `usage_logs` 中提供按日、按 session、按 agent/model 聚合的 token usage 统计。
- UI 需要 Usage Dashboard 所需的 summary、daily usage、streak/stats 等 HTTP 接口。

## Current Behavior Evidence

- 旧 IPC `UsageService` 提供 `getDailyUsage/getUsageSummary/getUsageStats/getSessionUsage`。
- usage 写入由 `chat.message-completed` 事件订阅器负责，本 capability 本身主要是读模型查询。

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
