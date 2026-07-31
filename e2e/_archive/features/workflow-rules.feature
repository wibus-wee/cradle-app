# language: zh-CN

@cradle
功能: Workflow Rules 管理

  作为用户，我可以在工作区详情页通过真实 UI 管理全局与 Agent 专属 Workflow Rules

  @P1 @CRADLE-WORKFLOW-RULES-001
  场景: 保存并重新打开 All Agents 规则
    假如 我已打开一个 Workflow Rules 工作区详情页
    当 我切换到 Workflow 标签
    而且 我在当前 Workflow 范围保存规则:
      """
      Always summarize the plan before starting work.

      Keep updates concise and actionable.
      """
    那么 当前 Workflow 编辑器中应显示规则:
      """
      Always summarize the plan before starting work.

      Keep updates concise and actionable.
      """
    当 我关闭当前工作区详情标签
    而且 我重新打开当前工作区的详情页
    而且 我切换到 Workflow 标签
    那么 当前 Workflow 编辑器中应显示规则:
      """
      Always summarize the plan before starting work.

      Keep updates concise and actionable.
      """

  @P1 @CRADLE-WORKFLOW-RULES-002
  场景: 保存 Agent 专属规则并验证 scope 切换与重新打开
    假如 我已通过真实 UI 创建一个 Workflow Agent "Workflow Agent"
    而且 我已打开该 Workflow Agent 可用的工作区详情页
    当 我切换到 Workflow 标签
    而且 我切换到 Agent "Workflow Agent" 的 Workflow 范围
    而且 我在当前 Workflow 范围保存规则:
      """
      Reply as Workflow Agent only when directly assigned.

      Escalate blockers immediately.
      """
    那么 当前 Workflow 编辑器中应显示规则:
      """
      Reply as Workflow Agent only when directly assigned.

      Escalate blockers immediately.
      """
    当 我切换到“All Agents”Workflow 范围
    那么 当前 Workflow 编辑器应该为空
    当 我切换到 Agent "Workflow Agent" 的 Workflow 范围
    那么 当前 Workflow 编辑器中应显示规则:
      """
      Reply as Workflow Agent only when directly assigned.

      Escalate blockers immediately.
      """
    当 我关闭当前工作区详情标签
    而且 我重新打开当前工作区的详情页
    而且 我切换到 Workflow 标签
    而且 我切换到 Agent "Workflow Agent" 的 Workflow 范围
    那么 当前 Workflow 编辑器中应显示规则:
      """
      Reply as Workflow Agent only when directly assigned.

      Escalate blockers immediately.
      """
