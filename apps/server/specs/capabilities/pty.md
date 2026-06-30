# Capability: PTY

## User / System Goal

- 系统需要为 `cli-tui` provider 的 chat session 提供 session-owned terminal runtime。
- 第一阶段重点是：start-or-attach、输出流、buffer replay、input、resize、delete/cleanup。
- server-first 版本不保留 Electron broadcaster / generic shell 兼容层；只做 chat session 绑定的 terminal runtime。

## Current Behavior Evidence

- 旧 `pty-manager` 负责启动/停止/写入/resize 与缓冲区回放。
- `ipc/pty.ts` 按 `sessionId -> workspace.path -> cli-tui profile config` 启动终端。
- renderer `TuiView` 已经依赖：attach existing / replay buffer / write input / resize / explicit delete 才 stop。
- `SessionCleanup` 在 server 中预留了 session 删除副作用挂点。

## Target API (Slice 1)

- `POST /terminal-sessions/:sessionId/start-or-attach`
- `GET /terminal-sessions/:sessionId/stream`
- `POST /terminal-sessions/:sessionId/input`
- `POST /terminal-sessions/:sessionId/resize`
- `DELETE /terminal-sessions/:sessionId`

## Target Module Design

- `PtyModule`
  - `PtyController`: HTTP 参数校验 + SSE stream surface
  - `PtyService`: session/profile/workspace resolution + terminal lifecycle semantics
  - `PtyStore`: DB-backed session/profile/workspace lookups
  - `PtySessionManager`: process/buffer/subscriber runtime owner
- `SessionCleanup` 在 session 删除时调用 `PtySessionManager.destroy(sessionId)`。
- 第一阶段使用 server-owned child-process terminal runtime，不迁移 generic bottom-shell。

## Test Plan

- cli-tui session 可 start-or-attach，并通过 SSE 收到 buffer replay 与后续 output。
- input 会写入子进程并收到回显。
- 删除 terminal session 或删除 chat session 会触发 exit/cleanup。
- 缺失 session、非 cli-tui profile、非法输入返回结构化错误。
