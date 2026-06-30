# language: zh-CN

@cradle
功能: Usage Dashboard
  作为用户，我希望从真实入口查看 token 用量，并确认聊天产生的 usage 会显示在仪表盘中

  背景:
    假如 应用已启动

  @P1 @CRADLE-USAGE-001
  场景: 从侧栏打开 Usage Dashboard 时没有 usage 数据会显示空状态
    当 我从侧栏打开 Usage Dashboard
    那么 我应该看到 Usage Dashboard
    而且 Usage Dashboard 应显示空状态

  @P1 @CRADLE-USAGE-002
  场景: 聊天产生 usage 后 Usage Dashboard 会显示精确汇总
    假如 我已配置 Mock LLM Provider
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天页面
    当 我在新建聊天输入框中输入"usage-dashboard-target"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 最后一条 AI 消息应包含"Hello from mock LLM!"
    当 我从侧栏打开 Usage Dashboard
    那么 我应该看到 Usage Dashboard
    而且 Usage Dashboard 应显示以下关键值:
      | 总 Tokens         | 19 |
      | Prompt Tokens     | 10 |
      | Completion Tokens | 9  |
      | 总 Turns          | 1  |
      | 今日 Tokens       | 19 |
      | 活跃天数          | 1  |
    而且 Usage Dashboard Heatmap 今天的提示应显示"19 tokens · 1 turns"
