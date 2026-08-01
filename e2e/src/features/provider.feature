# language: zh-CN
@cradle
功能: Provider 设置精华旅程
  作为用户，我希望通过设置 UI 创建指向 model-api-simulator 的 Claude Agent profile

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-PROVIDER-001
  场景: 通过 UI 创建 Anthropic Simulator profile
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
