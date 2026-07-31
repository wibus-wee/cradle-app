# language: zh-CN

@cradle
功能: Jarvis 系统助手

  作为用户，我可以从应用底部打开 Jarvis，并在未配置或已配置模型时得到明确反馈

  背景:
    假如 应用已启动

  @P1 @CRADLE-JARVIS-001
  场景: 未配置 Provider 时打开 Jarvis 面板
    当 我打开 Jarvis 面板
    那么 我应该看到 Jarvis 面板
    而且 Jarvis 面板应提示尚未配置 profile
    而且 Jarvis 输入框应处于禁用状态
    当 我关闭 Jarvis 面板
    那么 Jarvis 面板不应显示

  @P1 @CRADLE-JARVIS-002
  场景: 配置 Provider 后在 Jarvis 面板发送消息
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"OpenAI-compatible"
    而且 我在 Provider 表单填写 Name 为"Jarvis Panel Mock"
    而且 我在 Provider 表单填写 Base URL 为 Jarvis Mock 地址
    而且 我在 Provider 表单填写 Model 为"gpt-4o-mini"
    而且 我在 Provider 表单填写 API Key 为"test-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为成功
    而且 Provider 列表中应显示名为"Jarvis Panel Mock"的 profile
    当 我点击"Jarvis"设置导航项
    那么 我应该看到 Jarvis 设置页面
    当 我在 Jarvis 模型选择器选择 Provider "Jarvis Panel Mock"
    那么 Jarvis 模型选择器应显示模型"GPT-4o-mini"
    当 我关闭设置并返回首页
    而且 我打开 Jarvis 面板
    那么 我应该看到 Jarvis 面板
    而且 Jarvis 输入框应处于可用状态
    当 我在 Jarvis 面板输入"Jarvis panel e2e message"
    而且 我发送 Jarvis 消息
    那么 Jarvis 面板应显示用户消息"Jarvis panel e2e message"
    而且 Jarvis 面板应显示 AI 回复
