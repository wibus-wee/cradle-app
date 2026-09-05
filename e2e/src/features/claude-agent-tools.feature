# language: zh-CN
@cradle @runtime-claude
功能: Claude Agent 工具矩阵
  作为用户，我希望通过真实 Claude Agent SDK 遍历 canonical 工具词汇中的每一类工具调用，
  在零真实 API 成本下验证工具执行、活动流投影与条目详情渲染

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-AGENT-005
  场景: TodoWrite 待办工具完成投影与条目详情闭环
    假如 我已配置 Claude Agent 工具矩阵 Simulator（"todo-todo-write"）
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天并选中 Simulator
    当 我在新建聊天输入框中输入"请执行工具矩阵场景"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 聊天活动流应包含"Updated todos"
    当 我展开聊天活动流中包含"Updated todos"的条目
    那么 聊天活动流应包含"矩阵待办"
    而且 最后一条 AI 消息应包含"工具矩阵 todo-todo-write 完成"
    而且 聊天流应结束于空闲状态
    而且 聊天中不应出现错误提示
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-AGENT-006
  场景: TaskCreate 任务创建工具完成投影闭环
    假如 我已配置 Claude Agent 工具矩阵 Simulator（"todo-task-create"）
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天并选中 Simulator
    当 我在新建聊天输入框中输入"请执行工具矩阵场景"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 聊天活动流应包含"Updated todos"
    而且 最后一条 AI 消息应包含"工具矩阵 todo-task-create 完成"
    而且 聊天流应结束于空闲状态
    而且 聊天中不应出现错误提示
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-AGENT-007
  场景: WebFetch 网络工具完成投影闭环
    假如 我已配置 Claude Agent 工具矩阵 Simulator（"web-web-fetch"）
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天并选中 Simulator
    当 我在新建聊天输入框中输入"请执行工具矩阵场景"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 聊天活动流应包含"https://example.com/e2e-tool-matrix"
    而且 最后一条 AI 消息应包含"工具矩阵 web-web-fetch 完成"
    而且 聊天流应结束于空闲状态
    而且 聊天中不应出现错误提示
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-AGENT-008
  场景: MCP 工具命名约定完成分类闭环
    假如 我已配置 Claude Agent 工具矩阵 Simulator（"mcp-probe"）
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天并选中 Simulator
    当 我在新建聊天输入框中输入"请执行工具矩阵场景"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 聊天活动流应包含"Called"
    而且 最后一条 AI 消息应包含"工具矩阵 mcp-probe 完成"
    而且 聊天流应结束于空闲状态
    而且 聊天中不应出现错误提示
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-AGENT-009
  场景: ScheduleWakeup 归入 generic 工具条目
    假如 我已配置 Claude Agent 工具矩阵 Simulator（"generic-schedule-wakeup"）
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天并选中 Simulator
    当 我在新建聊天输入框中输入"请执行工具矩阵场景"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 聊天活动流应包含"Schedule Wakeup"
    而且 最后一条 AI 消息应包含"工具矩阵 generic-schedule-wakeup 完成"
    而且 聊天流应结束于空闲状态
    而且 聊天中不应出现错误提示
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-AGENT-010
  场景: Artifact 创建更新与侧边面板持久化闭环
    假如 我已配置 Claude Agent Artifact 生命周期 Simulator
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天并选中 Simulator
    当 我在新建聊天输入框中输入"请创建并更新发布检查 Artifact"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 聊天应显示 Artifact "E2E Release Readiness"（ID "e2e-release-readiness"）的 revision 1
    而且 聊天应显示 Artifact "E2E Release Readiness"（ID "e2e-release-readiness"）的 revision 2
    当 我打开 Artifact "E2E Release Readiness" 的 revision 2
    那么 Artifact 面板应显示标题 "E2E Release Readiness"、ID "e2e-release-readiness"、revision 2 与内容 "5 of 5"
    而且 Artifact 面板不应显示旧内容 "3 of 5"
    当 我重新加载当前页面
    那么 应该跳转到聊天视图
    而且 聊天应显示 Artifact "E2E Release Readiness"（ID "e2e-release-readiness"）的 revision 2
    而且 Artifact 面板应显示标题 "E2E Release Readiness"、ID "e2e-release-readiness"、revision 2 与内容 "5 of 5"
    而且 Artifact 面板不应显示旧内容 "3 of 5"
    而且 最后一条 AI 消息应包含"Artifact 已更新到 revision 2 并可在侧边面板查看"
    而且 聊天流应结束于空闲状态
    而且 聊天中不应出现错误提示
    而且 Simulator 脚本化交换应全部耗尽
