# Capability: Git

## User / System Goal

- 用户需要基于真实 workspace 查看当前 Git 分支、工作区文件变更、浏览分支列表、切换/创建分支，并在 Git 面板查看真实提交图。
- server-first 版本必须避免 `workspacePath` 泄漏到客户端；Git API 统一以 `workspaceId` 为入口，由服务端解析仓库路径。
- 第一阶段交付覆盖读状态、文件变更、branch control、commit graph，不把 Git 做成完整客户端。

## Current Behavior Evidence

- 旧 `GitService` 暴露 `getStatus/getFileStatuses/getBranches/getGraph/checkout/createBranch/fetch`，全部直接吃 `workspacePath`。
- renderer 主路径实际依赖：header branch control、branch picker、right-aside git panel、commit graph。
- E2E 当前真实用户价值是：看到当前分支、创建并切换新分支、渲染真实提交图。

## Target API (Slice 1)

- `GET /workspaces/:workspaceId/git/status`，包含当前分支、tracking 信息与 normalized file statuses。
- `GET /workspaces/:workspaceId/git/branches`
- `GET /workspaces/:workspaceId/git/graph?limit=`
- `POST /workspaces/:workspaceId/git/checkout`
- `POST /workspaces/:workspaceId/git/branches`
- `POST /workspaces/:workspaceId/git/fetch`

## Target Module Design

- `GitModule`
  - `GitController`: workspace-owned HTTP routing and input validation
  - `GitService`: workspaceId → workspace.path resolution + simple-git orchestration
- Git 能力不把仓库路径暴露给客户端，也不写入其他 owner 的表。
- commit/push/pull/diff 等更重语义暂时后置。

## Test Plan

- 真实临时仓库可返回当前分支、文件变更、分支列表、提交图（包含 `--all` 历史）。
- 创建新分支会立即切换到新分支。
- checkout 可切换现有分支。
- 缺失 workspace 或非 git 仓库返回结构化错误。
