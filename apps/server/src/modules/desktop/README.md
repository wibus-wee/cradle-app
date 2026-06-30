# Desktop Module

这个目录拥有 Desktop/Electron 专用的 server-side 投影接口。它可以读取 chat、session、workspace、automation、Chronicle 等 namespace 的状态，但不拥有也不写入这些 namespace 的生命周期数据。

## 文件清单

- `index.ts`: exposes `/desktop/summary`, `/desktop/recent-sessions`, `/desktop/health`, and `/desktop/awaits` as read-only facts for Electron Desktop entry surfaces. These routes are intentionally not CLI-exposed.
- `model.ts`: Elysia response schemas for the Desktop projection contract.
- `service.ts`: read-only Desktop fact aggregation for running sessions, recent sessions, pending awaits, health, automation counts, provider counts, and workspace counts. Electron Desktop owns tray layout, ordering, labels, and action semantics.
