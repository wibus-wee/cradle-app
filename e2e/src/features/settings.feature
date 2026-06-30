# language: zh-CN

@cradle
功能: 应用设置

  作为用户，我可以在 Settings 中调整应用外观并准备支持反馈

  背景:
    假如 应用已启动

  @P1 @CRADLE-SETTINGS-001
  场景: 在 Support 设置中复制反馈模板
    当 我点击设置按钮
    而且 我点击"Support"设置导航项
    那么 我应该看到 Support 设置页面
    当 我复制 Support 反馈模板
    那么 剪贴板中应包含文本"# Cradle Preview Feedback"
    而且 Support 设置状态应显示"Feedback template copied."

  @P1 @CRADLE-SETTINGS-002
  场景: 在 Appearance 设置中切换主题
    当 我点击设置按钮
    而且 我点击"Appearance"设置导航项
    那么 我应该看到 Appearance 设置页面
    当 我选择外观主题"深色"
    那么 外观主题"深色"应处于选中状态
    而且 应用应切换到深色主题
    当 我选择外观主题"浅色"
    那么 外观主题"浅色"应处于选中状态
    而且 应用应切换到浅色主题

  @P1 @CRADLE-SETTINGS-003
  场景: 在浏览器环境中查看 Desktop 更新不可用状态
    当 我点击设置按钮
    而且 我点击"桌面端"设置导航项
    那么 我应该看到 Desktop Updates 设置页面
    而且 Desktop Updates 应显示当前环境不支持更新
    而且 Desktop Updates 操作按钮应不可用

  @P1 @CRADLE-SETTINGS-004
  场景: 在没有 Provider 时查看 Jarvis 模型空状态
    当 我点击设置按钮
    而且 我点击"Jarvis"设置导航项
    那么 我应该看到 Jarvis 设置页面
    而且 Jarvis 模型选择器应显示空 Provider 状态

  @P1 @CRADLE-SETTINGS-005
  场景: 为 Jarvis 选择已配置的 Provider
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"OpenAI-compatible"
    而且 我在 Provider 表单填写 Name 为"Jarvis Mock"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我在 Provider 表单填写 Model 为"mock-model"
    而且 我在 Provider 表单填写 API Key 为"test-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为成功
    而且 Provider 列表中应显示名为"Jarvis Mock"的 profile
    当 我点击"Jarvis"设置导航项
    那么 我应该看到 Jarvis 设置页面
    当 我在 Jarvis 模型选择器选择 Provider "Jarvis Mock"
    那么 Jarvis 模型选择器应显示模型"mock-model"

  @P1 @CRADLE-SETTINGS-006
  场景: 在没有 Provider 时查看 Chronicle 记录设置依赖提示
    当 我点击设置按钮
    而且 我点击"记录"设置导航项
    那么 我应该看到 Chronicle 设置页面
    而且 Chronicle 设置应提示需要配置模型服务
    而且 Chronicle 整理模型选择器应显示空 Provider 状态
    而且 Chronicle 记录活动开关应不可用
    当 我从 Chronicle 设置跳转配置模型服务
    那么 我应该看到 Agent Runtime 设置页面
