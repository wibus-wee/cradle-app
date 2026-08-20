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

  @essence @P0 @CRADLE-WORK-002
  场景: 首个 Provider 请求失败后重载并在原 Work 主会话恢复
    假如 我已配置首个 Work 请求失败后可恢复的 Claude Agent Simulator
    而且 我已添加了一个真实 Git 工作区
    当 我打开 New Work
    而且 我在 New Work 中选择第一个工作区
    而且 我在 New Work 中选择 Claude Agent Simulator
    而且 我输入 Work 目标"首次 Work 请求触发 provider 错误"
    而且 我启动 Work
    那么 应该跳转到聊天视图
    而且 聊天错误提示应显示"E2E Work initial provider failure"
    而且 失败后的 Work 应保留唯一受管主会话
    当 我重新加载当前页面
    那么 我应该看到用户消息"首次 Work 请求触发 provider 错误"
    而且 失败后的 Work 应保留唯一受管主会话
    当 我在聊天输入框中输入"请在隔离 Work 中完成失败后的恢复验证"
    而且 我点击聊天发送按钮
    那么 最后一条 AI 消息应包含"Work 失败后的重试已完成"
    而且 聊天流应结束于空闲状态
    而且 恢复后的 Work 应仍使用原受管主会话并写入验证文件
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P0 @CRADLE-WORK-003
  场景: 停止运行中的 Work 后重载并在原主会话恢复
    假如 我已配置可停止后恢复的 Work Claude Agent Simulator
    而且 我已添加了一个真实 Git 工作区
    当 我打开 New Work
    而且 我在 New Work 中选择第一个工作区
    而且 我在 New Work 中选择 Claude Agent Simulator
    而且 我输入 Work 目标"请启动可停止的 Work"
    而且 我启动 Work
    那么 应该跳转到聊天视图
    而且 聊天流应处于进行中
    当 我点击停止生成按钮
    那么 停止生成按钮应消失
    而且 停止后聊天视图、侧栏会话与 Composer 状态应一致为空闲
    而且 停止后的 Work 应保留唯一受管主会话
    当 我重新加载当前页面
    那么 我应该看到用户消息"请启动可停止的 Work"
    而且 停止后的 Work 应保留唯一受管主会话
    当 我在聊天输入框中输入"请在停止后恢复隔离 Work"
    而且 我点击聊天发送按钮
    那么 最后一条 AI 消息应包含"Work 停止后的重试已完成"
    而且 聊天流应结束于空闲状态
    而且 停止恢复后的 Work 应仍使用原受管主会话并写入验证文件
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P0 @CRADLE-WS-004
  场景: 删除引用 Work 主会话和 PTY 的工作区会清理全部关联资源
    假如 我已配置会在 Work worktree 写文件的 Claude Agent Simulator
    而且 我已添加了一个真实 Git 工作区
    当 我打开 New Work
    而且 我在 New Work 中选择第一个工作区
    而且 我在 New Work 中选择 Claude Agent Simulator
    而且 我输入 Work 目标"在隔离 Work 中创建验证文件"
    而且 我启动 Work
    那么 应该跳转到聊天视图
    而且 最后一条 AI 消息应包含"Work 已完成"
    而且 聊天流应结束于空闲状态
    当 我打开底部终端面板
    那么 我应该看到底部终端面板
    而且 我记住当前 Work 工作区关联资源
    当 我打开该工作区的菜单
    而且 我点击"移除工作区"
    那么 已删除工作区当前页面应回到首页
    而且 我重新加载当前页面
    那么 已删除工作区不应保留会话、Work、worktree 或磁盘 checkout
    而且 我应该看到工作区列表为空
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P0 @CRADLE-WS-005
  场景: 删除运行中 Work 所在工作区会取消活跃执行且不会迟到写回
    假如 我已配置会在删除工作区前保持运行的 Work Claude Agent Simulator
    而且 我已添加了一个真实 Git 工作区
    当 我打开 New Work
    而且 我在 New Work 中选择第一个工作区
    而且 我在 New Work 中选择 Claude Agent Simulator
    而且 我输入 Work 目标"删除运行中的 Work 工作区"
    而且 我启动 Work
    那么 应该跳转到聊天视图
    而且 聊天流应处于进行中
    而且 Work 的慢速 Provider 响应已到达门控
    而且 我记住当前 Work 工作区关联资源
    当 我打开该工作区的菜单
    而且 我点击"移除工作区"
    那么 已删除工作区当前页面应回到首页
    而且 我重新加载当前页面
    那么 已删除工作区不应保留会话、Work、worktree 或磁盘 checkout
    而且 已删除 Work 的慢速 Provider 响应应已被取消
    而且 已删除工作区不应保留会话、Work、worktree 或磁盘 checkout
    而且 Simulator 脚本化交换应全部耗尽
