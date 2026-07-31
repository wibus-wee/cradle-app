# language: zh-CN
@cradle
功能: Agent Runtime 管理

  作为用户，我可以在设置中统一管理不同 Provider 的 Agent Profile

  @P1 @CRADLE-AGENT-RUNTIME-001
  场景: 导航到 Provider 设置页面
    当 我点击设置按钮
    而且 我点击"Providers"导航项
    那么 我应该看到 Agent Runtime 设置页面

  @P1 @CRADLE-AGENT-RUNTIME-002
  场景: Agent Runtime 设置页面显示 Provider 类型选择
    假如 我已进入 Agent Runtime 设置页面
    那么 我应该看到 Provider 类型选择

  @P1 @CRADLE-AGENT-RUNTIME-003
  场景: Agent Runtime 设置页面显示 Profile 列表或空状态
    假如 我已进入 Agent Runtime 设置页面
    那么 我应该看到 Agent Profile 列表或空状态

  @P1 @CRADLE-AGENT-RUNTIME-004
  场景: 通过 UI 创建 OpenAI-compatible profile
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"OpenAI-compatible"
    而且 我在 Provider 表单填写 Name 为"OpenAI Mock"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我在 Provider 表单填写 Model 为"mock-model"
    而且 我在 Provider 表单填写 API Key 为"test-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为成功
    而且 Provider 列表中应显示名为"OpenAI Mock"的 profile

  @P1 @CRADLE-AGENT-RUNTIME-005
  场景: Provider 探测失败时显示错误状态并保持对话框打开
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"OpenAI-compatible"
    而且 我在 Provider 表单填写 Name 为"Broken OpenAI"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为失败并提示"Credential is required"
    而且 Provider 对话框应保持打开

  @P1 @CRADLE-AGENT-RUNTIME-009
  场景: 通过 UI 创建 Codex profile 并显示成功状态
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"Codex"
    而且 我在 Provider 表单填写 Name 为"Codex Mock"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我在 Provider 表单填写 Model 为"codex-mini-latest"
    而且 我在 Provider 表单填写 API Key 为"test-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为成功
    而且 Provider 列表中应显示名为"Codex Mock"的 profile

  @P1 @CRADLE-AGENT-RUNTIME-010
  场景: 通过 UI 创建 Claude Agent profile 并显示成功状态
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"Claude Agent"
    而且 我在 Provider 表单填写 Name 为"Claude Agent Mock"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我在 Provider 表单填写 Model 为"claude-sonnet-4-20250514"
    而且 我在 Provider 表单填写 API Key 为"test-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为成功
    而且 Provider 列表中应显示名为"Claude Agent Mock"的 profile

  @P1 @CRADLE-AGENT-RUNTIME-006
  场景: 编辑已有 OpenAI-compatible profile
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"OpenAI-compatible"
    而且 我在 Provider 表单填写 Name 为"Legacy OpenAI"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我在 Provider 表单填写 Model 为"gpt-4o-mini"
    而且 我在 Provider 表单填写 API Key 为"legacy-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 列表中应显示名为"Legacy OpenAI"的 profile
    当 我打开名为"Legacy OpenAI"的 Provider
    而且 我编辑 Provider Name 为"Updated OpenAI"
    而且 我编辑 Provider Base URL 为"https://updated.example/v1"
    而且 我编辑 Provider Model 为"gpt-4.1-mini"
    而且 我编辑 Provider API Key 为"updated-key"
    而且 我保存 Provider 编辑
    那么 Provider 列表中应显示名为"Updated OpenAI"、模型为"gpt-4o-mini"的 profile

  @P1 @CRADLE-AGENT-RUNTIME-007
  场景: 删除已有 profile
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"OpenAI-compatible"
    而且 我在 Provider 表单填写 Name 为"Disposable Provider"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我在 Provider 表单填写 Model 为"gpt-4o-mini"
    而且 我在 Provider 表单填写 API Key 为"delete-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 列表中应显示名为"Disposable Provider"的 profile
    当 我移除名为"Disposable Provider"的 Provider
    那么 Provider 列表中不应显示名为"Disposable Provider"的 profile

  @P1 @CRADLE-AGENT-RUNTIME-008
  场景: 切换 profile 启用状态
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"OpenAI-compatible"
    而且 我在 Provider 表单填写 Name 为"Switchable Provider"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我在 Provider 表单填写 Model 为"gpt-4o-mini"
    而且 我在 Provider 表单填写 API Key 为"toggle-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 列表中应显示名为"Switchable Provider"的 profile
    当 我切换名为"Switchable Provider"的 Provider 启用状态
    那么 名为"Switchable Provider"的 Provider 应处于"禁用"状态
    当 我切换名为"Switchable Provider"的 Provider 启用状态
    那么 名为"Switchable Provider"的 Provider 应处于"启用"状态
