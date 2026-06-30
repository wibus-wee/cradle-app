# language: zh-CN
@cradle
功能: Issue Agent 委派集成

  作为用户，我可以把 Issue 委派给 Agent，并追踪关联会话与委派状态

  @P1 @CRADLE-ISSUE-AGENT-001
  场景: 将 Issue 委派给 Agent 后会生成并完成关联会话
    假如 我已添加了一个工作区
    而且 我已配置 Mock LLM Provider
    而且 我已创建了一个看板
    而且 我已在第一列创建了一个 Issue"委派测试"
    而且 我已打开名为"委派测试"的 Issue 详情面板
    当 我将当前 Issue 委派给"Mock LLM"
    那么 当前 Issue 的 Agent 会话应出现在详情面板中
    而且 当前 Issue 的 Agent 会话状态应显示"Done"
    而且 Activity 时间线应显示"Delegated to Mock LLM"
    而且 我可以打开当前 Issue 的 Agent 聊天会话
    而且 最后一条 AI 消息应包含"Hello from mock LLM!"

  @P1 @CRADLE-ISSUE-AGENT-002
  场景: 取消 Issue 委派会清理 Agent 绑定
    假如 我已添加了一个工作区
    而且 我已配置 Mock LLM Provider
    而且 我已创建了一个看板
    而且 我已在第一列创建了一个 Issue"取消委派测试"
    而且 我已打开名为"取消委派测试"的 Issue 详情面板
    而且 我已将当前 Issue 委派给"Mock LLM"
    当 我取消当前 Issue 的 Agent 委派
    那么 当前 Issue 不应再显示 Agent 委派
    而且 Activity 时间线应显示"Delegation removed"

  @P1 @CRADLE-ISSUE-AGENT-003
  场景: 已完成的 Issue Agent 会话可以重新运行并生成新的聊天会话
    假如 我已添加了一个工作区
    而且 我已配置 Mock LLM Provider
    而且 我已创建了一个看板
    而且 我已在第一列创建了一个 Issue"重新运行测试"
    而且 我已打开名为"重新运行测试"的 Issue 详情面板
    而且 我已将当前 Issue 委派给"Mock LLM"
    那么 当前 Issue 的 Agent 会话应显示可重新运行
    当 我重新运行当前 Issue 的 Agent 会话
    那么 当前 Issue 的 Agent 会话状态应显示"Done"
    而且 当前 Issue 的 Agent 会话应显示可重新运行
    而且 Activity 时间线应显示"Agent session re-run"
    而且 我可以打开当前 Issue 的 Agent 聊天会话
    而且 最后一条 AI 消息应包含"Hello from mock LLM!"
