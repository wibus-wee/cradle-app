# language: zh-CN
@cradle @P0
功能: 模型与运行时选择

  作为用户
  我希望在发送消息前选择运行时、Provider 和模型

  背景:
    假如 应用已启动
    而且 我已配置 Mock LLM Provider

  @CRADLE-MODEL-001
  场景: 新会话页面打开 Provider 与模型选择器
    当 我进入新会话页面
    而且 我打开 Provider 与模型选择器
    那么 应该看到可用的 Provider 列表

  @CRADLE-MODEL-002
  场景: 选择 Provider 后发送消息使用该模型
    当 我进入新会话页面
    而且 我选择 Mock LLM Provider
    而且 我发送消息"你好"
    那么 应该收到 Agent 的回复

  @CRADLE-MODEL-003
  场景: 选择 Provider 后工具栏展示当前模型
    当 我进入新会话页面
    而且 我选择 Mock LLM Provider
    那么 Provider 与模型选择器应显示模型"mock-model"

  @CRADLE-MODEL-004
  场景: 新会话页面打开运行时选择器
    当 我进入新会话页面
    而且 我打开运行时选择器
    那么 应该看到可用的运行时列表
