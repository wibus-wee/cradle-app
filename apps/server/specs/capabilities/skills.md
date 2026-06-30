# Capability: Skills

## User / System Goal

- 系统需要提供跨 `builtin` / 标准全局 `.agents` / 仓库 `.agents` / Cradle-only / `workspace` / `agent` scope 的 skills 清单与文档读取。
- HTTP client 需要支持技能 CRUD、导入导出，以及从本地或 git source 发现并导入 skill package。
- server 必须保持 namespace ownership：只读消费 `builtin`、标准全局 `.agents` 与仓库 `.agents` skills，只写入 Cradle 自己拥有的 Cradle-only / `workspace` / `agent` 作用域。

## Current Behavior Evidence

- 旧 `SkillsService` 暴露 `list/get/create/update/delete/import/export/fetchSource/importFromFetch/cancelFetch`。
- 旧 skills library 是纯 filesystem-first，实现 scope precedence、shadowing、导入导出与缓存。
- `builtin`、标准全局 `.agents` 与仓库 `.agents` scope 为只读；Cradle-only / `workspace` / `agent` 为可写。
- source fetch 支持 local path 与 git/github/gitlab 仓库扫描多个 skill package。

## Target API

- `GET /skills?workspaceId=&agentId=` → `SkillInventoryEntry[]`
- `GET /skills/document?scope=&name=&workspaceId=&agentId=` → `SkillDocument`
- `POST /skills` → 创建 skill
- `PUT /skills/document` → 更新或重命名 skill
- `DELETE /skills/document?scope=&name=&workspaceId=&agentId=` → 删除 skill
- `POST /skills/import` → 从本地目录导入 skill package
- `POST /skills/export` → 导出 skill package 到目标目录
- `POST /skills/fetch-source` → 扫描 source 内 skill package
- `POST /skills/import-from-fetch` → 从 fetch session 选择性导入 skill package
- `POST /skills/cancel-fetch` → 清理 fetch session

## Target Module Design

- `SkillsModule`
  - `SkillsController`: HTTP 参数校验与错误边界
  - `SkillsService`: workspace path 解析、fetch session 约束、错误映射
  - `skills.store.ts`: scope inventory、CRUD、import/export
  - `skill-source.store.ts`: source 解析、clone / local scan、session cleanup
  - `skills-paths.ts`: scope root 解析与写权限规则

## Test Plan

- scope precedence 与 `shadowedBy` 正确返回，包括仓库 `.agents` 覆盖全局 Cradle-only、workspace `.cradle` 覆盖仓库 `.agents`。
- `workspace` / `agent` scope CRUD 生效，且写入落到 Cradle-owned 路径。
- `export` 与 `fetch-source + import-from-fetch` 工作正常。
- 只读 scope、缺失 workspace、缺失 fetch session、非法 source 返回结构化错误。
