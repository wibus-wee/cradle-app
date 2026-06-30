<!-- Once this directory changes, update this README.md -->

# E2E/Steps

这里的 step definitions 把 feature 文本绑定到 Playwright 驱动的 Electron 自动化。
步骤应优先复用、聚焦可观察行为，并只在必要时通过测试专用 IPC 建立前置状态。
当 feature 语义调整时，应优先修改这里，而不是把业务细节塞回 feature 文本。
除非场景明确就是合约测试，否则不要在这里新增数据库、请求 payload、事件序列等内部实现断言。
Mock LLM Provider 配置会在服务端 profile 落库后重载当前页面，避免已完成的 renderer 查询缓存住空 Provider 列表。

## Files

- **agent-identity.steps.ts**: Agent 设置导航、Provider 前置准备、创建 / 列表展示 / Provider→Model 联动 / 编辑 / 删除交互，以及 Thinking Effort 的可见状态断言
- **agent-runtime-settings.steps.ts**: Provider 设置导航、OpenAI-compatible / Codex / Claude Agent profile 创建 / 编辑 / 删除 / 启停 / 探测失败断言，聚焦可见列表和状态变化
- **chat.steps.ts**: 模拟 LLM 的聊天端到端步骤，覆盖多轮上下文在界面中的体现、Session 重命名 / Pin / 删除 / Markdown 导出、Reasoning 展示、Tool Call 渲染、成功、停止、错误与刷新恢复
- **git.steps.ts**: Git 端到端步骤，负责准备真实临时仓库、通过原生目录选择器添加工作区、驱动 Header branch picker 创建/切换分支，并断言右侧 Git 面板与提交图的真实渲染
- **home-dashboard.steps.ts**: Home dashboard 步骤，覆盖最近会话跳转、Automation Dashboard 快速入口、刷新空状态和返回首页
- **issue-agent-integration.steps.ts**: Issue 委派给 Agent、关联会话状态、取消委派与 rerun 步骤；覆盖从 Issue detail 打开关联 chat 后主侧栏会话列表可见性的真实断言
- **keyboard-shortcuts.steps.ts**: 全局 shell / layout / tab 快捷操作步骤，通过真实键盘输入和 Header 按钮驱动 `⌘,`、`Escape`、`⌘B`、`⌘⌥B`、`Ctrl+\``、`⌘T`、`⌘W`、`⌘1`、`Ctrl+Tab`、新建标签、aside 与 bottom panel 切换，并用最小布局状态锚点断言 sidebar / aside / panel / active tab 变化
- **kanban.steps.ts**: 看板、Issue 与评论步骤，覆盖跨列移动、看板删除、Issue 编辑 / 删除、子 Issue 创建、Status Column 增删改排序与 Issue 搜索的可见结果；仅保留最小化数据库读取辅助测试前置状态
- **model-selection.steps.ts**: 新会话 composer 的运行时、Provider 与模型选择步骤，覆盖 Provider/Model 菜单打开、Mock Provider 选择后的工具栏状态、消息发送和运行时菜单展示
- **plugins.steps.ts**: Plugin sidebar 步骤，覆盖 System Info plugin panel 打开、刷新、回到 Home 后重新激活与系统信息可见断言
- **right-aside.steps.ts**: 右侧 aside 步骤，覆盖 panel 打开、tab 切换（含 Changes）、Files 文件树搜索、Issue 关联 / 跳转和 Feed GitHub await composer checks/review 模式断言
- **resources.steps.ts**: Header Resources 步骤，覆盖资源诊断弹层打开、核心分组可见性、refresh 控制、ready 状态、Live footer，以及 Escape 关闭 / 重新打开路径
- **search.steps.ts**: 全局搜索真实入口步骤，复用聊天别名与可见 chat view 断言，覆盖线程标题高亮、消息片段高亮、打开对应会话、Issue / 文件结果、执行 Settings / Usage / New Chat / Sidebar 命令结果，以及 Escape 关闭状态
- **settings.steps.ts**: Settings 真实入口步骤，覆盖 Support 反馈模板复制、剪贴板结果、Appearance 主题选择状态与应用主题切换、Desktop Updates 状态、Jarvis 空状态、Jarvis Provider 选择断言，以及 Chronicle 无 Provider 依赖提示、模型选择器空状态和跳转 Providers 路径
- **skills.steps.ts**: Skills 真实 UI 步骤，覆盖全局 / 工作区 / Agent 三个 scope 的创建、查看、编辑、删除与导入；Agent 前置改为通过 Settings UI 创建 Provider→Agent，不再用文件落盘作为主要验收目标
- **system-agent.steps.ts**: Jarvis 系统助手步骤，覆盖底部入口打开 popover、未配置 Provider 空状态、禁用输入、配置后可用输入、发送消息与关闭行为
- **tab-management.steps.ts**: Tab 交互与相关 shell 行为步骤，先确保最小标签数量成立；内容保留断言基于激活 tab 对应的 content 容器，而不是依赖 React Activity 冻结 DOM 下不稳定的通用可见性属性
- **terminal.steps.ts**: 底部终端步骤，覆盖打开 / 关闭 panel、执行命令、读取 transcript、多 session 创建 / 切换 / 关闭的可见标签状态，以及重新打开 panel 后的会话输出保留
- **usage.steps.ts**: Usage Dashboard 真实入口步骤，复用聊天/工作区前置流，验证 Dashboard 的可见汇总值、空状态与热力图 tooltip
- **workflow-rules.steps.ts**: Workflow Rules UI 步骤，覆盖真实 Settings 中的 Provider / Agent 创建、工作区详情页 Workflow 标签编辑、scope 切换与关闭后重开；文件系统持久化改由 main 层单测兜底
- **workspace.steps.ts**: Workspace 添加 / 移除 / 重命名 / 多工作区切换 / 测试文件夹内容准备 / 新建聊天当前工作区选择 / 详情页直接开始任务步骤，聚焦列表、详情页、真实内容与聊天可见跳转
