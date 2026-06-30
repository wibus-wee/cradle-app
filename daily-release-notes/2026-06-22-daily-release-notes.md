# Cradle Dev Release Notes — 2026-06-22

如期而至的 Cradle Dev Release Notes！

## Features

1. **首发：Remote Runtime 全链路基础设施** — 新增 `@cradle/remote-agent-protocol` WebSocket 协议包、`@cradle/chat-runtime-contracts` 共享类型包、`agentd` 守护进程（PTY 管理 + Agent 生命周期）、远程主机 CRUD 与 Session Linking 服务端模块、DB Schema（`remote_runtime_hosts` / `session_links`），以及 `remote-mock` 开发用 Provider
2. **首次运行凭证配置引导** — 新增 Credential Setup Dialog，首次启动时引导完成 Provider 配置
3. **Command Palette 重建** — 键盘优先设计，支持 `>` 命令 / `/` 文件 / `#` Issue / `@` 会话 scope 前缀快速过滤
4. **Side Conversation 面板升级 Composer** — 替换原有 textarea，获得完整的编辑能力
5. **Windows 自动更新** — 基于 electron-updater 支持 Windows 桌面端自动升级
6. **macOS DMG 安装包** — 新增 appdmg 构建脚本与 `Install Cradle.command` 一键安装

## Fixes & Polish

1. **Skill 调用修复** — `$` 前缀触发的 Skill 未正确传递至 Claude Agent（CRA-043）
2. **Tiptap 图片加载修复** — `cradle-asset://` 图片在启用 resize 后无法显示（CRA-042）
3. **Windows 兼容性** — 修复 pnpm 路径与 `pathToFileURL` 导入；browser-use 改用 TCP loopback 替代 Unix socket
4. **Tool Block 重构** — 提取公共常量/工具函数，拆分 monolithic 组件，修复 grouped-tool-call 状态提示与暗色模式图标

---

> 工作区尚有未提交的 Settings 相关变更（remote-hosts-settings、i18n），未提交，不放入正式稿。
