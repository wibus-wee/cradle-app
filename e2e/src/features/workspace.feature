# language: zh-CN
@cradle
功能: 工作区管理

  作为用户，我可以添加和管理本地工作区

  @P0 @CRADLE-WORKSPACE-001
  场景: 应用启动后显示空状态
    那么 我应该看到工作区列表为空
    而且 我应该看到"添加工作区"按钮

  @P0 @CRADLE-WORKSPACE-002
  场景: 添加一个工作区
    当 我通过原生对话框添加工作区
    那么 工作区列表中应该有 1 个工作区

  @P1 @CRADLE-WORKSPACE-003
  场景: 删除一个工作区
    假如 我已添加了一个工作区
    当 我打开该工作区的菜单
    而且 我点击"移除工作区"
    那么 我应该看到工作区列表为空

  @P1 @CRADLE-WORKSPACE-004
  场景: 重命名一个工作区
    假如 我已添加了一个包含 AGENTS.md 的工作区
    当 我打开当前工作区的详情页
    而且 我将工作区重命名为 "Renamed Workspace"
    那么 工作区详情页标题应该是 "Renamed Workspace"
    而且 工作区列表中应该包含工作区 "Renamed Workspace"

  @P1 @CRADLE-WORKSPACE-005
  场景: 在多个工作区之间切换
    假如 我已添加了两个可区分的工作区
    那么 工作区列表中应该包含这 2 个工作区
    当 我打开第 1 个工作区的详情页
    那么 工作区详情页应该显示第 1 个工作区的真实内容
    当 我打开第 2 个工作区的详情页
    那么 工作区详情页应该显示第 2 个工作区的真实内容

  @P1 @CRADLE-WORKSPACE-006
  场景: 工作区详情页显示真实业务内容
    假如 我已添加了一个包含 AGENTS.md 的工作区
    当 我打开当前工作区的详情页
    那么 我应该看到工作区详情页的标签页
    而且 Overview 应该显示当前工作区的 AGENTS.md 内容

  @P1 @CRADLE-WORKSPACE-008
  场景: 从工作区详情页直接开始一次项目任务
    假如 我已进入 Agent Runtime 设置页面
    当 我点击添加 Provider 按钮
    而且 我在 Provider 类型下拉选择"OpenAI-compatible"
    而且 我在 Provider 表单填写 Name 为"Workspace Task Mock"
    而且 我在 Provider 表单填写 Base URL 为 Mock 地址
    而且 我在 Provider 表单填写 Model 为"mock-model"
    而且 我在 Provider 表单填写 API Key 为"test-key"
    而且 我点击提交 Provider 按钮
    那么 Provider 状态应为成功
    而且 Provider 列表中应显示名为"Workspace Task Mock"的 profile
    当 我关闭设置并返回首页
    而且 我已添加了一个包含 AGENTS.md 的工作区
    当 我打开当前工作区的详情页
    而且 我在工作区详情页输入任务"请解释这个项目的结构"
    而且 我从工作区详情页发送任务
    那么 应该跳转到聊天视图
    而且 我应该看到用户消息"请解释这个项目的结构"
    而且 最后一条 AI 消息应包含"Hello from mock LLM!"
    而且 聊天中不应出现错误提示
    当 我打开当前工作区的详情页
    那么 工作区详情页最近会话应显示"请解释这个项目的结构"
