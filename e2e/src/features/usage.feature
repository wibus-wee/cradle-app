# language: zh-CN
@cradle
功能: Usage 真实计量
  作为用户，我希望 Usage 显示真实 runtime 产生的 token，而不是只验证空仪表盘可见

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-USAGE-001
  场景: Claude Agent 完成一轮后 Usage 精确聚合并跨刷新保持
    假如 我已配置 Claude Agent Simulator
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天并选中 Simulator
    当 我在新建聊天输入框中输入"请生成一条可计量回复"
    而且 我点击发送按钮
    那么 最后一条 AI 消息应包含"Hello from Claude Agent E2E simulator!"
    而且 聊天流应结束于空闲状态
    当 我打开 Usage
    那么 Usage 应显示精确的 4 tokens 与 1 turn
    当 我重新加载当前页面
    那么 Usage 应显示精确的 4 tokens 与 1 turn
    而且 Simulator 脚本化交换应全部耗尽
