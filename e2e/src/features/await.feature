# language: zh-CN
@cradle
功能: Await 挂起与恢复
  作为用户，我希望会话 Await 跨刷新保持，并在外部条件完成后把恢复消息送回同一会话

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-AWAIT-001
  场景: JavaScript Await 持久化 pending 状态并由外部事件恢复真实 Agent
    假如 我已配置 Await 恢复 Claude Agent Simulator
    而且 我已添加了一个工作区
    当 我新建一个聊天会话并记住为"Await 会话"，首条消息为"开始 Await 测试"
    而且 我为会话"Await 会话"注册永不自动触发的 JavaScript Await
    而且 我打开会话 Await 面板
    那么 Await 面板应显示 pending 条件"E2E external condition"
    当 我重新加载当前页面
    而且 我打开会话 Await 面板
    那么 Await 面板应仍显示 pending 条件"E2E external condition"
    当 外部条件触发 Await 并恢复文本"E2E await resumed"
    那么 我应该看到用户消息"E2E await resumed"
    而且 最后一条 AI 消息应包含"Await 恢复后的真实回复"
    而且 聊天流应结束于空闲状态
    而且 Await 面板应显示 triggered 状态
    而且 Await 服务端状态应为 triggered
    而且 Simulator 脚本化交换应全部耗尽
