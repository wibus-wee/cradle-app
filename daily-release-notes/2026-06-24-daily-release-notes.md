# 如期而至的 Cradle Dev Release Notes！

> 2026-06-24

## Features

1. **首发支持 Claude 官方订阅登录** — Agent 创建/编辑面板新增 Auth Mode 选择，运行时支持 Claude 订阅账号直连，附 provider-targets 认证诊断
2. **Composer 就地编辑队列消息** — 支持在 Composer 中直接编辑待发送队列项，编辑时恢复原始上下文
3. **全局搜索支持 Workspace 结果** — 搜索对话框新增 Workspace 维度，快速定位工作区内容
4. **ChatView compactInset 模式** — 新增紧凑嵌入模式，适配窄窗口 Ambient 宿主
5. **Claude Agent 子线程列表** — 展示子代理线程及 token 用量，方便追踪多步任务

## Fixes & Polish

1. 修复队列编辑上下文丢失问题
2. 亮色模式 `muted-foreground` 对比度优化，满足 WCAG AA 标准

---

> ⚠️ 工作区存在未提交变更（Claude Agent provider 重构、diff-review 调整、changelog 功能等），未放入正式稿。
