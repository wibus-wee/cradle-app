# language: zh-CN
@cradle
功能: 真实 Claude Agent 精华旅程
  作为用户，我希望 Claude Agent 走真实 SDK 与 Anthropic Messages 协议完成审批与工具展示

  背景:
    假如 应用已启动

  @essence @P0 @CRADLE-AGENT-001
  场景: Agent 请求审批后用户批准并继续完成
    假如 我已配置 Claude Agent 审批 Simulator
    而且 我已添加了一个工作区
    当 我点击"新建聊天"导航项
    而且 我选择 Claude Agent 运行时与 Simulator Provider
    而且 我在新建聊天输入框中输入"请准备需要审批的计划"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    当 审批卡片出现
    而且 我点击"允许"按钮
    那么 审批卡片应该消失
    而且 最后一条 AI 消息应包含"Approved. The command execution plan completed."
    而且 聊天流应结束于空闲状态

  @essence @P1 @CRADLE-AGENT-002
  场景: Agent 请求审批后用户拒绝
    假如 我已配置 Claude Agent 审批 Simulator
    而且 我已添加了一个工作区
    当 我点击"新建聊天"导航项
    而且 我选择 Claude Agent 运行时与 Simulator Provider
    而且 我在新建聊天输入框中输入"请准备需要审批的计划"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    当 审批卡片出现
    而且 我点击"拒绝"按钮
    那么 审批卡片应该消失

  @essence @P1 @CRADLE-AGENT-003
  场景: Tool Call 审批卡会展示计划确认入口
    假如 我已配置 Claude Agent 审批 Simulator
    而且 我已添加了一个工作区
    当 我点击"新建聊天"导航项
    而且 我选择 Claude Agent 运行时与 Simulator Provider
    而且 我在新建聊天输入框中输入"请准备需要审批的计划"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    当 审批卡片出现
    那么 审批卡片应包含"implement this plan"

  @essence @P1 @CRADLE-AGENT-004
  场景: Agent 通过 Simulator 完成 Read 工具环并给出最终回复
    假如 我已配置 Claude Agent Read 工具环 Simulator
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天并选中 Simulator
    当 我在新建聊天输入框中输入"请读取 AGENTS.md 并确认"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 聊天活动流应包含"Read"
    而且 最后一条 AI 消息应包含"工具环完成：已读取 AGENTS.md"
    而且 聊天中不应出现错误提示
    而且 聊天流应结束于空闲状态
    而且 Simulator 脚本化交换应全部耗尽
