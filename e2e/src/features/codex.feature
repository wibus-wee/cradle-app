# language: zh-CN
@cradle
功能: 真实 Codex 精华旅程
  作为用户，我希望真实 Codex app-server 的上游 OpenAI Responses 走 model-api-simulator 完成一轮聊天

  背景:
    假如 应用已启动

  @essence @P0 @CRADLE-CODEX-001
  场景: Codex 通过 Simulator 完成一轮回复
    假如 我已配置 Codex Simulator
    而且 我已添加了一个工作区
    当 我点击"新建聊天"导航项
    而且 我选择 Codex 运行时与 Simulator Provider
    而且 我在新建聊天输入框中输入"Codex 精华第一轮"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 我应该看到用户消息"Codex 精华第一轮"
    而且 最后一条 AI 消息应包含"Hello from Codex E2E simulator!"
    而且 聊天中不应出现错误提示
    而且 聊天流应结束于空闲状态
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P0 @CRADLE-CODEX-004
  场景: Edit last message 回滚真实 Codex 轮次并只保留修改后的分支
    假如 我已配置 Codex Edit last message Simulator
    而且 我已添加了一个工作区
    当 我点击"新建聊天"导航项
    而且 我选择 Codex 运行时与 Simulator Provider
    而且 我在新建聊天输入框中输入"原始问题：请记住香蕉"
    而且 我点击发送按钮
    那么 最后一条 AI 消息应包含"Codex 原始轮次回复"
    当 我点击编辑上一条消息
    那么 聊天输入框应恢复上一条消息"原始问题：请记住香蕉"
    当 我在聊天输入框中输入"修改后的问题：请记住梨"
    而且 我点击聊天发送按钮
    那么 最后一条 AI 消息应包含"Codex 修改后的轮次回复"
    而且 聊天中不应再出现用户消息"原始问题：请记住香蕉"
    而且 聊天中不应再出现 AI 消息"Codex 原始轮次回复"
    当 我重新加载当前页面
    那么 我应该看到用户消息"修改后的问题：请记住梨"
    而且 最后一条 AI 消息应包含"Codex 修改后的轮次回复"
    而且 聊天中不应再出现用户消息"原始问题：请记住香蕉"
    而且 聊天中不应再出现 AI 消息"Codex 原始轮次回复"
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-CODEX-002
  场景: Codex 多轮对话保持上下文
    假如 我已配置 Codex 多轮 Simulator
    而且 我已添加了一个工作区
    当 我点击"新建聊天"导航项
    而且 我选择 Codex 运行时与 Simulator Provider
    而且 我在新建聊天输入框中输入"第一轮：请记住香蕉"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 最后一条 AI 消息应包含"Codex 第一轮：已记住香蕉"
    当 我在聊天输入框中输入"第二轮：请总结"
    而且 我点击聊天发送按钮
    那么 最后一条 AI 消息应包含"Codex 第二轮：你让我记住了香蕉"
    而且 聊天中不应出现错误提示
    而且 聊天流应结束于空闲状态
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-CODEX-003
  场景: Codex btw 快速提问复用上下文但不写入聊天历史
    假如 我已配置 Codex btw Simulator
    而且 我已添加了一个工作区
    当 我点击"新建聊天"导航项
    而且 我选择 Codex 运行时与 Simulator Provider
    而且 我在新建聊天输入框中输入"Codex 初始上下文消息"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 最后一条 AI 消息应包含"Codex 初始上下文已准备好"
    当 我在聊天输入框中输入"/btw 请确认当前上下文"
    而且 我点击聊天发送按钮
    那么 Composer 的 btw 结果应包含"Codex btw 回复：上下文仍然可见"
    而且 聊天中不应出现错误提示
    而且 Simulator 脚本化交换应全部耗尽
