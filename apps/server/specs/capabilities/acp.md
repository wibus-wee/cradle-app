# ACP Capability SPEC

## Goal

在 `apps/server` 中重建 ACP management capability：支持 registry 浏览、分发类型查询、已安装 agent 清单、安装/卸载、审计记录查询。

这是 HTTP-first 的 server capability，不走 Electron IPC compatibility。

## Current Behavior Evidence

- 旧应用服务：`src/main/acp-feature/acp.ts`
- 旧 IPC 适配：`src/main/app/ipc/acp.ts`
- 旧平台实现：`src/main/acp/acp-registry.ts`、`src/main/acp/acp-installer.ts`
- 数据表已存在：`packages/db/src/schema/acp.ts`

## Product Semantics

- ACP registry 是外部 catalog 数据源
- 服务端负责安装状态和审计记录
- 安装记录属于 Cradle-owned persistence：`acp_agents`、`acp_audit_log`
- HTTP server first：用 `fetch` / Node FS 替换 Electron transport 和 userData API

## Target HTTP API

- `GET /acp/registry`
- `GET /acp/registry/:agentId/distribution-types`
- `GET /acp/agents`
- `GET /acp/agents/:agentId`
- `PUT /acp/agents/:agentId/installation`
- `DELETE /acp/agents/:agentId/installation`
- `DELETE /acp/agents/:agentId`
- `GET /acp/audit`
- `GET /acp/agents/:agentId/install-path`

安装请求体：

```json
{
  "distributionType": "binary | npx | uvx"
}
```

## Dependencies

- `DatabaseModule` / `DbAccessor`
- Node `fetch`
- Node FS + archive extraction（binary 分发）
- `ServerConfig` / `CRADLE_DATA_DIR`

## Non-Goals

- Electron IPC compatibility layer
- renderer push / devtool event bridge
- 自动同步 `profiles`
- ACP prompt/session/chat-runtime 整合
- 默认 auto-approve 权限流

## Test Plan

- registry fetch + distribution types
- install `npx` agent，写入 `acp_agents` 与 `acp_audit_log`
- uninstall agent，删除安装记录并追加审计
- invalid install payload：结构化 400
- missing/unsupported agent：结构化 404/409
