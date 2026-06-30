# Capability: Search

## User / System Goal

- 系统需要跨 session title、user message、assistant timeline 文本提供 thread search。
- HTTP client 需要支持全局搜索与 workspace scoped 搜索。

## Current Behavior Evidence

- 旧 `SearchService` 委托 `ThreadSearchEngine.search()`。
- 搜索优先使用 FTS5；FTS 不可用或为空时回退到 legacy full-scan。
- assistant 命中应基于 timeline delta 聚合后的文本，而不是仅靠 message fallback content。

## Target API

- `GET /search/threads?query=&workspaceId=&limit=&snippetsPerHit=` → `ThreadSearchHit[]`

## Target Module Design

- `SearchModule`
  - `SearchController`: HTTP API
  - `SearchService`: parameter validation + query orchestration
  - `ThreadSearchEngine`: FTS/legacy search engine

## Test Plan

- assistant timeline 文本可被搜索命中。
- workspaceId 过滤生效。
- 空 query / 非法 limit 返回 400。
