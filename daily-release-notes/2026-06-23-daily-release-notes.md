# 如期而至的 Cradle Dev Release Notes！

> 2026-06-23 · Asia/Shanghai

## Features

1. **首发：Remote Relay 基础设施** — 全新 relay 协议包 `@cradle/remote-relay-protocol`、Go relay 守护进程 `relayd`（WebSocket 房间路由）、agentd relay-client、server 端 SSH 隧道 + relay transport，打通远程 Agent Runtime 连接链路
2. **设置页侧边栏重构** — 原 Runtime 分组拆分为 Agent / Extensions，Desktop 与 Shortcuts 归入 General；新增搜索框，支持中英日西四语模糊匹配（CRA-049）
3. **远程主机管理 UI** — 设置页新增 Remote Hosts 配置面板，支持 SSH 隧道远程主机的增删改查
4. **Diff Review 体验打磨** — git-ref-picker、inline-thread、review-top-bar、thread-composer 等组件优化，测试覆盖率提升
5. **Agent 管理与 Onboarding 优化** — Codex 账号诊断面板增强、Browser Panel 集成改进、凭据设置流程更顺畅

## Fixes & Polish

1. **Side Conversation 不再过期** — 移除 TTL 机制，侧边对话持久保留
2. **依赖更新与国际化补齐** — 多语言文案同步，API-Gen 刷新，CLI 命令文档更新

---

> ⚠️ 工作区另有未提交变更（remote-agent-protocol 帧测试与 methods 扩展等），不放入正式稿。
