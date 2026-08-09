# language: zh-CN
@cradle
功能: 文件上下文进入真实 Agent 请求
  作为用户，我希望在 Composer 中提及工作区文件后，文件内容确实进入 runtime，而不只是显示一个装饰性 token

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-CONTEXT-001
  场景: 通过 @mention 选择 AGENTS.md 并由 Simulator 校验真实请求内容
    假如 我已配置会校验文件上下文的 Claude Agent Simulator
    而且 我已添加了一个包含 AGENTS.md 的工作区
    而且 我已导航到新建聊天并选中 Simulator
    而且 我在新建聊天中选择当前工作区
    当 我在新建聊天中提及文件"AGENTS.md"并输入"请根据被提及的文件回答"
    而且 我点击发送按钮
    那么 最后一条 AI 消息应包含"文件上下文已随真实请求到达 Claude Agent"
    而且 Simulator 请求应包含文件内容"Workspace Detail overview content used for end-to-end verification."
    而且 聊天流应结束于空闲状态
    而且 Simulator 脚本化交换应全部耗尽
