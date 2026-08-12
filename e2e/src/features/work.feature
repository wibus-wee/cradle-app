# language: zh-CN
@cradle
功能: Work 主生命周期
  作为用户，我希望从 New Work 创建隔离执行，并确认 Agent 的改动真实落在受管 worktree 中

  背景:
    假如 应用已启动

  @essence @P0 @CRADLE-WORK-001
  场景: New Work 创建隔离 worktree、运行 Agent 并持久化真实文件改动
    假如 我已配置会在 Work worktree 写文件的 Claude Agent Simulator
    而且 我已添加了一个真实 Git 工作区
    当 我打开 New Work
    而且 我在 New Work 中选择第一个工作区
    而且 我在 New Work 中选择 Claude Agent Simulator
    而且 我输入 Work 目标"在隔离 Work 中创建验证文件"
    而且 我输入 Work 验收标准"验证文件存在且内容正确"
    而且 我启动 Work
    那么 应该跳转到聊天视图
    而且 最后一条 AI 消息应包含"Work 已完成"
    而且 聊天流应结束于空闲状态
    而且 Work 应创建受管 worktree 与持久化主会话
    而且 Work 应展示带权威证据的状态与恢复承诺
    而且 Needs me 应给出可直接打开该 Work 的下一行动
    而且 Simulator 脚本化交换应全部耗尽
