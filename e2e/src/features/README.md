<!-- Once this directory changes, update this README.md -->

# E2E/Features

这里存放面向用户行为的 Cucumber feature 文件，描述打包后的 Electron 应用应满足的端到端流程。
Feature 只表达行为，不嵌入具体实现细节，具体自动化绑定在 `e2e/src/steps/`。
新增跨进程能力时，应优先在这里补一个用户视角的回归场景。
优先级标签应尽量放在 scenario 级别，避免 feature 级继承污染 `@P0/@P1/@P2` 的执行范围。

## Files

- **agent-identity.feature**: Agent 身份设置的导航、空状态，以及 Agent 创建 / 列表展示 / Provider→Model 联动 / 编辑 / 删除等可见结果回归
- **agent-runtime-settings.feature**: Provider 设置与运行时 profile 管理，覆盖 OpenAI-compatible / Codex / Claude Agent profile 的 UI 创建、编辑、删除、启停与探测失败状态
- **chat.feature**: 聊天 happy path、多轮上下文在界面中的体现、Session 重命名 / Pin / 删除 / Markdown 导出、Reasoning 展示、Tool Call 渲染、停止生成、provider 错误与刷新恢复
- **git.feature**: Git 真实工作流回归，覆盖通过 UI 添加真实 Git 工作区、经新建聊天进入 chat tab、Header 分支控件、branch picker 创建/切换分支，以及右侧 Git 面板提交图渲染
- **home-dashboard.feature**: Home dashboard 入口回归，覆盖启动首页、最近会话跳转，以及从首页快速操作进入 Automation Dashboard、刷新空状态后返回
- **issue-agent-integration.feature**: Issue 委派给 Agent 后的关联会话、完成状态、取消委派，以及已完成会话的 rerun→新聊天会话生成→回到主侧栏后的会话列表刷新
- **keyboard-shortcuts.feature**: 全局 shell / layout / tab 快捷操作回归，覆盖 `⌘,`/`Escape`、`⌘B`、聊天标签页中的 `⌘⌥B`/`Ctrl+\``，`⌘T`/`⌘W`/`⌘1`/`Ctrl+Tab` 的真实键盘路径，以及 Header 新建标签 / aside / bottom panel 按钮路径
- **kanban.feature**: 看板、Issue 与评论基础流程，以及 Issue 跨列移动、看板删除、Issue 编辑 / 删除、子 Issue 创建、Status Column 管理与 Issue 搜索的可见结果回归
- **model-selection.feature**: 新会话 composer 的运行时、Provider 与模型选择回归，覆盖 Provider/Model 菜单打开、Mock Provider 选择后的工具栏状态、发送消息使用所选模型，以及运行时菜单选项展示
- **plugins.feature**: Plugin sidebar 真实入口回归，覆盖 System Info plugin panel 打开、系统信息展示、刷新后的可见结果，以及回到 Home 后重新激活插件面板
- **right-aside.feature**: 右侧 aside 真实上下文面板回归，覆盖聊天上下文中的 Files 文件树搜索、Issue 关联 / 打开详情，以及 Feed GitHub await composer 的 checks/review 模式切换
- **resources.feature**: Header Resources 资源诊断弹层回归，覆盖 renderer/server/Chronicle/terminal 核心分组展示、手动刷新、ready 状态、Live footer，以及关闭后重新打开
- **search.feature**: GlobalSearchDialog 真实入口回归，覆盖标题命中与消息内容命中的高亮展示、打开对应会话，Issue / 文件结果打开目标视图，命令结果打开 Settings / Usage / New Chat 和切换侧栏的 app shell 联动，以及 Escape 关闭后保留当前页面
- **settings.feature**: Settings 真实入口回归，覆盖 Appearance 主题切换、Support 反馈模板复制、Desktop Updates 不可用状态、Jarvis 无 Provider 模型空状态、Jarvis Provider 选择联动，以及 Chronicle 无 Provider 时的记录依赖提示与跳转配置路径
- **skills.feature**: Skills 真实 UI 回归，覆盖全局 / 工作区 / Agent 三个 scope 的创建、查看、编辑、删除与导入；Agent 私有技能场景必须先通过 Settings UI 创建 Provider→Agent，再进入内嵌 detail/skills 视图验证可见结果
- **system-agent.feature**: Jarvis 系统助手真实入口回归，覆盖底部 Ask Jarvis 入口、popover readiness、未配置 Provider 时的空状态、禁用输入与关闭行为，以及配置 Provider 后的可用输入和消息发送
- **tab-management.feature**: Tab 创建、切换与持久化行为
- **terminal.feature**: 底部终端真实工作流回归，覆盖工作区终端命令输出、多终端 session 的创建 / 切换 / 关闭，以及 bottom panel 关闭后重新打开的会话输出保留
- **usage.feature**: Usage Dashboard 真实入口回归，覆盖无 usage 数据时的空状态，以及真实聊天后的精确汇总与热力图 tooltip
- **user-journeys.feature**: 核心用户旅程回归，覆盖添加工作区后开始聊天，以及创建看板与 Issue 的跨功能路径
- **workflow-rules.feature**: Workflow Rules 真实入口回归，覆盖工作区详情页 Workflow 标签中的 All Agents / Agent-scoped 规则保存、scope 切换与重开后的可见结果
- **workspace.feature**: Workspace 空状态、添加、移除、重命名、多工作区切换、详情页 Overview 真实内容，以及从详情页直接开始项目任务的真实路径回归
