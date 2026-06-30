# Capability: Kanban

## User / System Goal

- 系统需要提供 workspace-scoped Kanban board/view configuration。
- Kanban 只拥有 board shell 和 view/filter 配置；Issue 数据、状态、里程碑、评论、关联和 context refs 由 Issue capability 拥有。
- Kanban 可以读取 workspace issues 作为视图数据，但不能成为 issue 的写侧 owner。

## Current Behavior Evidence

- 旧 `KanbanService` 暴露 board/status/milestone/issue/comment/relation/session-link 的大而全 IPC 面，导致 Kanban 被误当成 Issue owner。
- Issue owner 迁移后，`apps/server/src/modules/kanban` 只保留 board routes；Issue 写侧在 `apps/server/src/modules/issue`。
- board detail 目前本质是 workspace-scoped issue 视图，而不是 board-specific query model。

## Target API (Slice 1)

- `GET /kanban/boards?workspaceId=`
- `POST /kanban/boards`
- `DELETE /kanban/boards/:id`
- `PATCH /kanban/boards/:id`

Issue-owned routes live under `/issues`, including `/issues/statuses`, `/issues/milestones`, `/issues/:id/comments`, and `/issues/relations`.

## Target Module Design

- `KanbanModule`
  - `KanbanController`: HTTP input validation
  - `KanbanService`: board persistence and workspace validation
  - `KanbanStore`: DB-backed board/view configuration queries and writes

## Test Plan

- board 可创建、列出、更新、删除。
- 创建 board 不写 Issue-owned status 数据。
- 缺失 workspace/board 与非法输入返回结构化错误。
- OpenAPI 不再暴露 `/kanban/issues`、`/kanban/statuses`、`/kanban/milestones`、`/kanban/comments` 或 `/kanban/relations`。
