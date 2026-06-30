# language: zh-CN
@cradle
功能: Agent Identity 管理

  作为用户，我可以在设置中创建、编辑和删除具有独立身份的 Agent

  @P1 @CRADLE-AGENT-IDENTITY-001
  场景: 导航到 Agent 设置页面
    当 我点击设置按钮
    而且 我点击"Agents"导航项
    那么 我应该看到 Agent 列表页面

  @P1 @CRADLE-AGENT-IDENTITY-002
  场景: Agent 列表页面显示空状态
    假如 我已进入 Agent 列表页面
    那么 我应该看到 Agent 空状态提示

  @P1 @CRADLE-AGENT-IDENTITY-003
  场景: 点击新建 Agent 按钮进入创建页面
    假如 我已进入 Agent 列表页面
    当 我点击"New Agent"按钮
    那么 我应该看到 Agent 创建页面

  @P1 @CRADLE-AGENT-IDENTITY-004
  场景: Agent 创建页面显示头像预览
    假如 我已进入 Agent 列表页面
    而且 我已打开 Agent 创建页面
    那么 我应该看到 DiceBear 头像预览

  @P1 @CRADLE-AGENT-IDENTITY-005
  场景: 完整创建 Agent
    假如 我已准备名为"Primary Provider"模型为"o3-mini"的 Agent Provider
    而且 我已进入 Agent 列表页面
    当 我点击"New Agent"按钮
    而且 我填写 Agent 名称为"Planner Agent"
    而且 我选择 Agent Provider 为"Primary Provider"
    而且 我选择 Agent Model 为"o3-mini"
    而且 我选择 Agent Thinking Effort 为"high"
    而且 我点击创建 Agent 保存按钮
    那么 Agent 详情页应显示名称为"Planner Agent"
    当 我返回 Agent 列表
    那么 Agent 列表中应显示名称为"Planner Agent"、Provider 为"Primary Provider"、Model 为"o3-mini"的条目

  @P1 @CRADLE-AGENT-IDENTITY-006
  场景: Agent 列表展示已创建的 Agent
    假如 我已准备名为"Primary Provider"模型为"gpt-4o-mini"的 Agent Provider
    而且 我已有一个名称为"Listed Agent"、Provider 为"Primary Provider"、Model 为"gpt-4o-mini"、Thinking Effort 为"medium"的 Agent
    而且 我已进入 Agent 列表页面
    那么 Agent 列表中应显示名称为"Listed Agent"、Provider 为"Primary Provider"、Model 为"gpt-4o-mini"的条目

  @P1 @CRADLE-AGENT-IDENTITY-007
  场景: 编辑 Agent 名称与 Thinking Effort
    假如 我已准备名为"Primary Provider"模型为"o3-mini"的 Agent Provider
    而且 我已有一个名称为"Draft Agent"、Provider 为"Primary Provider"、Model 为"o3-mini"、Thinking Effort 为"high"的 Agent
    而且 我已进入 Agent 列表页面
    当 我打开名称为"Draft Agent"的 Agent
    而且 我填写 Agent 名称为"Draft Agent Updated"
    而且 我选择 Agent Thinking Effort 为"low"
    那么 Agent 详情页应显示名称为"Draft Agent Updated"
    而且 当前 Agent Thinking Effort 应显示"low"
    而且 Agent 详情应显示已保存状态
    当 我返回 Agent 列表
    那么 Agent 列表中应显示名称为"Draft Agent Updated"、Provider 为"Primary Provider"、Model 为"o3-mini"的条目

  @P1 @CRADLE-AGENT-IDENTITY-008
  场景: 删除已有 Agent
    假如 我已准备名为"Primary Provider"模型为"gpt-4o-mini"的 Agent Provider
    而且 我已有一个名称为"Disposable Agent"、Provider 为"Primary Provider"、Model 为"gpt-4o-mini"、Thinking Effort 为"medium"的 Agent
    而且 我已进入 Agent 列表页面
    当 我打开名称为"Disposable Agent"的 Agent
    而且 我删除当前 Agent
    那么 Agent 列表中不应显示名称为"Disposable Agent"的条目

  @P1 @CRADLE-AGENT-IDENTITY-009
  场景: 切换 Provider 后 Agent Model 应联动更新
    假如 我已准备名为"Alpha Provider"模型为"alpha-model"的 Agent Provider
    而且 我已准备名为"Beta Provider"模型为"beta-model"的 Agent Provider
    而且 我已进入 Agent 列表页面
    当 我点击"New Agent"按钮
    而且 我填写 Agent 名称为"Provider Bound Agent"
    而且 我选择 Agent Provider 为"Alpha Provider"
    那么 当前 Agent Model 应显示"alpha-model"
    当 我选择 Agent Provider 为"Beta Provider"
    那么 当前 Agent Model 应显示"beta-model"
    当 我点击创建 Agent 保存按钮
    那么 Agent 详情页应显示名称为"Provider Bound Agent"
    当 我返回 Agent 列表
    那么 Agent 列表中应显示名称为"Provider Bound Agent"、Provider 为"Beta Provider"、Model 为"beta-model"的条目
