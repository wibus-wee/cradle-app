# language: zh-CN
@cradle
功能: 富 Composer 用户旅程

  作为用户，我希望在 Composer 中通过 @ 提及文件与 $ 触发 Skill，通过 ! 执行本地命令，通过 / 触发 slash 命令与运行时能力，把工作区上下文与运行时能力直接串起来

  背景:
    假如 应用已启动
    而且 我已配置 Mock LLM Provider

  @P0 @CRADLE-JOURNEY-003
  场景: 通过 @ 提及文件后发送聊天
    假如 我已添加了一个包含文件 README.md 的工作区
    当 我通过原生对话框添加工作区
    而且 我点击"新建聊天"导航项
    当 我在 Composer 中输入"@README" 触发文件提及
    而且 我从提及面板选择文件"README.md"
    当 我继续在 Composer 中输入" 请帮我总结一下"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 我应该看到用户消息"@README.md 请帮我总结一下"
    而且 Mock LLM 应收到包含 README.md 内容的请求
    而且 最后一条 AI 消息应包含"Hello from mock LLM!"

  @P1 @CRADLE-JOURNEY-004
  场景: 通过 $ 触发 Skill 后发送聊天
    假如 我已通过真实 Settings UI 创建一个 Agent "JourneyAgent"
    而且 我新建一个 Agent Skill "summarize"
    当 我点击"新建聊天"导航项
    而且 我在 Composer 中输入"$summarize"
    而且 我从 Skill 面板选择 Skill "summarize"
    当 我继续在 Composer 中输入" 请总结 README.md"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 我应该看到用户消息包含"$summarize"
    而且 Mock LLM 应收到包含 Skill 内容的请求

  @P0 @CRADLE-JOURNEY-010
  场景: 通过 ! 触发 bang 命令执行本地 shell
    假如 我已添加了一个工作区
    而且 我已新建聊天并发送首条消息
    当 我在 Composer 中输入"!echo hello-from-bang"
    那么 Composer 应显示 bang 命令预览"$ echo hello-from-bang"
    而且 发送按钮文案应变为 Bang
    当 我点击发送按钮
    那么 聊天视图应显示 bang 命令提示块"$ echo hello-from-bang"
    而且 Mock LLM 不应收到 bang 命令正文
    而且 聊天视图应显示 bang 结果块，stdout 包含"hello-from-bang"
    而且 聊天视图应显示 bang 结果块的 exit 标签"exit 0"

  @P0 @CRADLE-JOURNEY-011
  场景: 通过 /side 打开 BrowserPanel 侧会话
    假如 我已新建聊天并发送首条消息
    当 我在 Composer 中输入"/side"
    而且 我从 slash 命令面板选择"side"
    那么 Composer 应显示"/side "等待参数
    当 我在 Composer 中输入"先聊一个旁支"
    而且 我点击发送按钮
    那么 BrowserPanel 应打开一个新的 side 会话标签
    而且 当前 Cradle 会话不应创建新的 turn
    而且 side 会话应收到包含"先聊一个旁支"的请求

  @P1 @CRADLE-JOURNEY-012
  场景: 通过 /appshot 触发 Mac Bridge 屏幕捕获
    假如 我已添加了一个工作区
    而且 我已新建聊天并发送首条消息
    而且 我已选择支持附件的 Provider
    当 我在 Composer 中输入"/appshot"
    而且 我从 slash 命令面板选择"appshot"
    那么 Composer 应触发 AppShot 捕获
    而且 桌面应展示原生 AppShot 顶部指示条
    当 AppShot 捕获完成
    那么 Composer 应出现已附着的 AppShot 缩略图
    而且 我点击发送按钮后 Mock LLM 应收到包含 AppShot 附件的请求

  @P1 @CRADLE-JOURNEY-013
  场景: 通过 /btw 触发系统级快速提问
    假如 我已新建聊天并发送首条消息
    当 我在 Composer 中输入"/btw 今天发生了什么"
    而且 我点击发送按钮
    那么 Composer 应清空
    而且 系统级 Jarvis 会话应收到提问"今天发生了什么"
    而且 当前聊天会话不应创建新的 turn

  @P0 @CRADLE-JOURNEY-014
  场景: 浏览 slash 命令面板并选择运行时命令
    假如 我已新建聊天并发送首条消息
    当 我在 Composer 中输入"/"
    那么 slash 命令面板应显示
    而且 slash 命令面板应包含 "side"
    而且 slash 命令面板应包含 "appshot"
    而且 slash 命令面板应显示当前 Runtime 提供的运行时命令
    当 我用 ArrowDown 选中"Cradle"标签的命令
    而且 我按 Enter 选择
    那么 Composer 应被填充该命令的模板文本
    而且 slash 命令面板应关闭

  @P1 @CRADLE-JOURNEY-015
  场景: slash 命令缺失必填参数时发送按钮被禁用
    假如 我已新建聊天并发送首条消息
    当 我在 Composer 中输入"/side"
    而且 我从 slash 命令面板选择"side"
    那么 Composer 应提示参数占位"[message]"
    而且 发送按钮应处于禁用状态
    当 我继续在 Composer 中输入"继续聊主线"
    那么 发送按钮应恢复为可点击

  @P0 @CRADLE-JOURNEY-016
  场景: 通过 Shift+Tab 切换 Plan 发送模式
    假如 我已新建聊天并发送首条消息
    当 我点击 Composer 中的运行时设置下拉
    而且 我在 interaction 区域选择"Plan"
    那么 运行时设置下拉应显示"Plan"
    而且 发送按钮应显示"Plan"标签
    当 我在 Composer 中输入"为登录页画一个 plan"
    而且 我点击 Plan 发送按钮
    那么 Mock LLM 应收到 runtimeSettings.interactionMode 为"plan"的请求

  @P1 @CRADLE-JOURNEY-017
  场景: 通过运行时设置下拉切换 full-access 跳过审批
    假如 我已新建聊天并发送首条消息
    当 我点击 Composer 中的运行时设置下拉
    而且 我在 access 区域选择"Full access"
    那么 运行时设置下拉应显示"Full access"
    当 我在 Composer 中输入"无需审批直接执行"
    而且 我点击发送按钮
    那么 Mock LLM 应收到 runtimeSettings.accessMode 为"full-access"的请求