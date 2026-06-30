# language: zh-CN
@cradle @P0
功能: 审批流程

  作为用户
  我希望在 Agent 需要确认时看到审批卡片
  并能批准或拒绝

  背景:
    假如 应用已启动
    而且 我已配置 Mock LLM Provider

  @CRADLE-APPROVAL-001
  场景: Agent 请求审批后用户批准
    假如 已创建一个需要审批的会话
    当 审批卡片出现
    而且 我点击"允许"按钮
    那么 审批卡片应该消失
    而且 Agent 应该继续执行

  @CRADLE-APPROVAL-002
  场景: Agent 请求审批后用户拒绝
    假如 已创建一个需要审批的会话
    当 审批卡片出现
    而且 我点击"拒绝"按钮
    那么 审批卡片应该消失
