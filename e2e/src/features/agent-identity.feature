# language: zh-CN
@cradle
功能: Agent Identity 精华旅程
  作为用户，我希望创建并删除一个独立 Agent

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-AGENT-ID-001
  场景: 创建 Agent 后可从列表删除
    假如 我已准备名为"Primary Provider"模型为"o3-mini"的 Agent Provider
    而且 我已进入 Agent 列表页面
    当 我点击"New Agent"按钮
    而且 我填写 Agent 名称为"Planner Agent"
    而且 我选择 Agent Provider 为"Primary Provider"
    而且 我选择 Agent Model 为"o3-mini"
    而且 我点击创建 Agent 保存按钮
    那么 Agent 详情页应显示名称为"Planner Agent"
    当 我返回 Agent 列表
    那么 Agent 列表中应显示名称为"Planner Agent"、Provider 为"Primary Provider"、Model 为"o3-mini"的条目
    当 我打开名称为"Planner Agent"的 Agent
    而且 我删除当前 Agent
    那么 Agent 列表中不应显示名称为"Planner Agent"的条目
