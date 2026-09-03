# language: zh-CN
@cradle @runtime-claude
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

  @essence @P0 @CRADLE-AWAIT-002
  场景: 取消与超时 Await 在进程重启后仍拒绝迟到的外部解析
    假如 我已配置 Await 终态 Claude Agent Simulator
    而且 我已添加了一个工作区
    当 我新建一个聊天会话并记住为"Await 终态会话"，首条消息为"开始 Await 终态测试"
    而且 我为会话"Await 终态会话"注册可取消的 JavaScript Await
    而且 我为会话"Await 终态会话"注册已经超时的 JavaScript Await
    而且 我打开会话 Await 面板
    那么 Await 面板应显示 pending 条件"E2E cancellable condition"
    而且 Await 面板应显示条件"E2E expired condition"为 expired
    当 我在 Await 面板取消条件"E2E cancellable condition"
    那么 Await 面板应显示条件"E2E cancellable condition"为 cancelled
    当 Cradle Server 在 Await 终态后崩溃并使用原数据目录重启
    而且 我打开会话 Await 面板
    那么 Await 面板应显示条件"E2E cancellable condition"为 cancelled
    而且 Await 面板应显示条件"E2E expired condition"为 expired
    当 迟到的外部条件尝试解析已取消和已超时的 Await
    那么 Await 终态服务端应仍为 cancelled 和 expired
    而且 聊天中不应再出现用户消息"E2E cancelled await late resolution"
    而且 聊天中不应再出现用户消息"E2E expired await late resolution"
    当 我在聊天输入框中输入"Await 终态后继续主对话"
    而且 我点击聊天发送按钮
    那么 最后一条 AI 消息应包含"Await 终态后的主对话仍可用"
    而且 聊天流应结束于空闲状态
    而且 Simulator 脚本化交换应全部耗尽
