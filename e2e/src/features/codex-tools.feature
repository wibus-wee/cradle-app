# language: zh-CN
@cradle @runtime-codex @serial
功能: Codex 工具调用词汇表
  作为用户，我希望真实 Codex app-server 在上游 Responses 走 model-api-simulator 时，
  完成真实的本地工具执行（shell、计划、文件补丁、审批）并投影到聊天活动流
  （工具条目按产品设计渲染在活动流中；plan 类渲染为独立块）

  背景:
    假如 应用已启动

  @essence @P0 @CRADLE-CODEX-005
  场景: exec_command 真实执行 shell 命令并投影终端条目
    假如 我已配置 Codex exec_command Simulator
    而且 我已添加了一个工作区
    当 我点击"新建聊天"导航项
    而且 我选择 Codex 运行时与 Simulator Provider
    而且 我在新建聊天输入框中输入"请运行回显命令"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 聊天活动流应包含"cradle-e2e-command-output"
    而且 最后一条 AI 消息应包含"Codex 工具轮已完成"
    而且 聊天流应结束于空闲状态
    而且 聊天中不应出现错误提示
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-CODEX-006
  场景: update_plan 计划工具真实执行并回传结果
    假如 我已配置 Codex update_plan Simulator
    而且 我已添加了一个工作区
    当 我点击"新建聊天"导航项
    而且 我选择 Codex 运行时与 Simulator Provider
    而且 我在新建聊天输入框中输入"请按两步计划推进"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 Simulator 请求应包含"Plan updated"
    而且 最后一条 AI 消息应包含"Codex 工具轮已完成"
    而且 聊天流应结束于空闲状态
    而且 聊天中不应出现错误提示
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-CODEX-007
  场景: apply_patch 文件变更投影 diff 条目
    假如 我已配置 Codex apply_patch Simulator
    而且 我已添加了一个工作区
    当 我点击"新建聊天"导航项
    而且 我选择 Codex 运行时与 Simulator Provider
    而且 我在新建聊天输入框中输入"请在工作区内创建补丁文件"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 聊天活动流应包含"e2e-codex-file-change.txt"
    而且 最后一条 AI 消息应包含"Codex 工具轮已完成"
    而且 聊天流应结束于空闲状态
    而且 聊天中不应出现错误提示
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-CODEX-008
  场景: 沙盒外命令触发真实审批并在允许后完成
    假如 我已配置 Codex 审批 Simulator
    而且 我已添加了一个工作区
    当 我点击"新建聊天"导航项
    而且 我选择 Codex 运行时与 Simulator Provider
    而且 我选择需要审批的访问模式
    而且 我在新建聊天输入框中输入"请在沙盒外写入探针文件"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    当 我允许 Codex 命令审批
    那么 最后一条 AI 消息应包含"Codex 工具轮已完成"
    而且 聊天活动流应包含"cradle-e2e-command-output"
    而且 聊天流应结束于空闲状态
    而且 聊天中不应出现错误提示
    而且 Simulator 脚本化交换应全部耗尽
