# Capability: Preferences

## User / System Goal

- 系统需要提供一个 server-owned 的全局 chat defaults 存储，用于保存默认 `modelId` 与 `configSelections`。
- server-first 版本只迁移 chat preferences，不迁移 Electron window bounds、dock/window state 等 native 偏好。
- 数据必须落在 server 自己的 dataDir namespace，而不是继续依赖 Electron store。

## Current Behavior Evidence

- 旧 `PreferencesService` 只暴露 `getChatPreferences` / `setChatPreferences`。
- 旧 `app/store/app.ts` 中 `electron-store` 的业务价值部分仅是 `chatPreferences`；`windows` 属于 Electron UI 状态，不属于 HTTP server 核心。
- `src/shared/chat-preferences.ts` 已定义 canonical contract：`StoredChatPreferences`。

## Target API (Slice 1)

- `GET /preferences/chat`
- `PUT /preferences/chat`

## Target Module Design

- `PreferencesModule`
  - `PreferencesController`: HTTP surface 与输入校验
  - `PreferencesService`: chat preferences 读写语义
  - `PreferencesStore`: filesystem-backed JSON persistence under server data dir
  - `PreferencesConfig`: resolve `${dataDir}/preferences/chat.json`
- 返回值始终遵守 `StoredChatPreferences` contract；缺失文件时返回默认值。
- 第一阶段不实现 workspace/window/appearance 等更多偏好项。

## Test Plan

- 缺失文件时，`GET /preferences/chat` 返回默认 preferences。
- `PUT /preferences/chat` 后会持久化到 server data dir，并且后续 `GET` 能读回。
- 非法 payload 返回结构化 `invalid_preferences_input` 错误。