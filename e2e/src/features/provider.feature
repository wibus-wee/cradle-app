# language: zh-CN
@cradle
功能: Provider 设置精华旅程
  作为用户，我希望通过设置 UI 创建指向 model-api-simulator 的 Claude Agent profile

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-PROVIDER-001
  场景: 通过 UI 创建、使用并禁用 Anthropic Simulator profile
    假如 Simulator 已启动
    当 我打开 Providers 设置页
    而且 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"Anthropic"
    而且 我在 Provider 表单填写 Name 为"E2E UI Claude"
    而且 我在 Provider 表单填写 Base URL 为 Anthropic Simulator 地址
    而且 我在 Provider 表单填写 API Key 为"sk-ant-e2e-ui"
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为成功
    而且 Provider 列表中应显示名为"E2E UI Claude"的 profile
    当 我为 UI 创建的 Provider 准备真实 Claude 回复
    而且 我已添加了一个工作区
    而且 我点击"新建聊天"导航项
    而且 我在新建聊天选择名为"E2E UI Claude"的 Claude Agent Provider
    而且 我在新建聊天输入框中输入"验证 UI Provider 闭环"
    而且 我点击发送按钮
    那么 最后一条 AI 消息应包含"UI Provider 已完成真实 Claude Agent 回复"
    而且 聊天流应结束于空闲状态
    当 我在 Providers 设置中打开名为"E2E UI Claude"的 profile
    而且 我禁用当前 Provider
    那么 新建聊天中不应提供名为"E2E UI Claude"的 Provider
    而且 Simulator 脚本化交换应全部耗尽
