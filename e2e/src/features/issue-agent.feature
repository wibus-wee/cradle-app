# language: zh-CN
@cradle @runtime-claude
功能: Issue Agent 委派生命周期
  作为用户，我希望 Issue 委派、Agent Session、Chat 与取消状态始终一致，不会因刷新或重跑产生幽灵执行

  背景:
    假如 应用已启动

  @essence @P0 @CRADLE-ISSUE-AGENT-001
  场景: Issue 委派完成后跨刷新持久化并可重跑到新的 Chat
    假如 我已配置 Issue "修复跨模块竞态"的完成与重跑 Claude Agent Simulator
    而且 我已创建名为"委派生命周期"的看板
    而且 我已在第一列创建了一个 Issue"修复跨模块竞态"
    而且 我已打开名为"修复跨模块竞态"的 Issue 详情面板
    当 我将当前 Issue 委派给 Agent "E2E Claude Agent"
    那么 当前 Issue 的 Agent Session 阶段应为"Done"
    而且 当前 Issue 活动应包含"Delegated to E2E Claude Agent"
    当 我重新加载并重新打开 Issue "修复跨模块竞态"
    那么 当前 Issue 的 Agent Session 阶段应为"Done"
    当 我重跑当前 Issue 的 Agent Session
    那么 当前 Issue 的 Agent Session 阶段应为"Running"
    当 我释放当前 Issue 的重跑门控
    那么 当前 Issue 的 Agent Session 阶段应为"Done"
    当 我打开当前 Issue 的 Agent Chat
    那么 最后一条 AI 消息应包含"Issue 委派重跑已完成"
    而且 聊天流应结束于空闲状态
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P0 @CRADLE-ISSUE-AGENT-002
  场景: 运行中刷新后取消委派会终止 Run 且不会幽灵完成
    假如 我已配置 Issue "取消活动委派"的可取消慢速 Claude Agent Simulator
    而且 我已创建名为"委派取消"的看板
    而且 我已在第一列创建了一个 Issue"取消活动委派"
    而且 我已打开名为"取消活动委派"的 Issue 详情面板
    当 我将当前 Issue 委派给 Agent "E2E Claude Agent"
    那么 当前 Issue 的 Agent Session 阶段应为"Running"
    当 我重新加载并重新打开 Issue "取消活动委派"
    那么 当前 Issue 的 Agent Session 阶段应为"Running"
    当 我取消当前 Issue 的委派
    那么 当前 Issue 活动应包含"Delegation removed"
    当 我打开当前 Issue 的已链接 Chat
    那么 聊天中不应出现完整的慢速回复
    而且 聊天流应结束于空闲状态
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P0 @CRADLE-ISSUE-AGENT-003
  场景: Issue 隔离委派创建关联 Work 与受管 worktree
    假如 我已添加了一个真实 Git 工作区
    而且 我已配置 Issue "实现隔离交付"的隔离 Work Claude Agent Simulator
    而且 我已创建名为"隔离委派"的看板
    而且 我已在第一列创建了一个 Issue"实现隔离交付"
    而且 我已打开名为"实现隔离交付"的 Issue 详情面板
    当 我启用当前 Issue 的隔离 Work 委派
    而且 我将当前 Issue 委派给 Agent "E2E Claude Agent"
    那么 当前 Issue 的 Agent Session 阶段应为"Done"
    当 我打开当前 Issue 的 Agent Chat
    那么 最后一条 AI 消息应包含"Issue 隔离 Work 已完成"
    而且 当前 Issue 委派应创建关联的隔离 Work "实现隔离交付"
    而且 聊天流应结束于空闲状态
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P0 @CRADLE-ISSUE-AGENT-004
  场景: 运行中的隔离委派取消后保留可审计 Work 且停止执行
    假如 我已添加了一个真实 Git 工作区
    而且 我已配置 Issue "取消隔离委派"的可取消慢速 Claude Agent Simulator
    而且 我已创建名为"隔离委派取消"的看板
    而且 我已在第一列创建了一个 Issue"取消隔离委派"
    而且 我已打开名为"取消隔离委派"的 Issue 详情面板
    当 我启用当前 Issue 的隔离 Work 委派
    而且 我将当前 Issue 委派给 Agent "E2E Claude Agent"
    那么 当前 Issue 的 Agent Session 阶段应为"Running"
    当 我重新加载并重新打开 Issue "取消隔离委派"
    而且 我取消当前 Issue 的委派
    那么 当前 Issue 活动应包含"Delegation removed"
    当 我打开当前 Issue 的已链接 Chat
    那么 聊天中不应出现完整的慢速回复
    而且 已取消的隔离 Issue 委派应保留关联 Work "取消隔离委派"
    而且 聊天流应结束于空闲状态
    而且 Simulator 脚本化交换应全部耗尽
