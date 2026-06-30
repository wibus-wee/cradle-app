# language: zh-CN

@cradle
功能: Skills 管理

  作为用户，我可以通过真实 UI 管理工作区与 Agent 专属 Skills

  @P1 @CRADLE-SKILLS-004
  场景: 在工作区详情页创建 Workspace Skill
    假如 我已打开一个工作区详情页
    当 我切换到 Workspace Skills 标签
    而且 我新建一个工作区 Skill
    那么 我应该看到工作区 Skill "workspace-demo"
    当 我打开 Skill "workspace-demo"
    那么 当前 Skill 详情应显示描述为 "Workspace demo skill"
    而且 当前 Skill 详情应显示内容为:
      """
      # Workspace Demo

      Scoped to one workspace.
      """

  @P1 @CRADLE-SKILLS-005
  场景: 通过真实 Settings UI 为 Agent 创建专属 Skill
    假如 我已通过真实 Settings UI 创建一个 Agent "Skill Keeper"
    当 我打开 Agent "Skill Keeper" 的 Skills 管理
    而且 我新建一个 Agent Skill
    那么 我应该看到 Agent Skills 页面
    而且 我应该看到 Agent Skill "agent-demo"
    当 我打开 Skill "agent-demo"
    那么 当前 Skill 详情应显示描述为 "Agent demo skill"
    而且 当前 Skill 详情应显示内容为:
      """
      # Agent Demo

      Private to one agent.
      """

  @P1 @CRADLE-SKILLS-007
  场景: 在工作区 Skills 页面编辑并删除 Skill
    假如 我已打开一个工作区详情页
    当 我切换到 Workspace Skills 标签
    而且 我新建一个工作区 Skill
    而且 我打开 Skill "workspace-demo"
    而且 我编辑当前 Skill 名称为 "workspace-demo-updated"
    而且 我编辑当前 Skill 描述为 "Workspace demo skill updated"
    而且 我编辑当前 Skill 内容为:
      """
      # Workspace Demo Updated

      Workspace-specific instructions only.
      """
    而且 我保存当前 Skill
    那么 我应该看到工作区 Skill "workspace-demo-updated"
    当 我打开 Skill "workspace-demo-updated"
    那么 当前 Skill 详情应显示描述为 "Workspace demo skill updated"
    而且 当前 Skill 详情应显示内容为:
      """
      # Workspace Demo Updated

      Workspace-specific instructions only.
      """
    而且 我不应该看到 Skill "workspace-demo"
    当 我删除当前 Skill
    那么 我不应该看到 Skill "workspace-demo-updated"

  @P1 @CRADLE-SKILLS-008
  场景: 通过真实 Settings UI 编辑并删除 Agent 专属 Skill
    假如 我已通过真实 Settings UI 创建一个 Agent "Skill Editor"
    当 我打开 Agent "Skill Editor" 的 Skills 管理
    而且 我新建一个 Agent Skill
    而且 我打开 Skill "agent-demo"
    而且 我编辑当前 Skill 名称为 "agent-demo-updated"
    而且 我编辑当前 Skill 描述为 "Agent demo skill updated"
    而且 我编辑当前 Skill 内容为:
      """
      # Agent Demo Updated

      Only Skill Editor should read this.
      """
    而且 我保存当前 Skill
    那么 我应该看到 Agent Skill "agent-demo-updated"
    当 我打开 Skill "agent-demo-updated"
    那么 当前 Skill 详情应显示描述为 "Agent demo skill updated"
    而且 当前 Skill 详情应显示内容为:
      """
      # Agent Demo Updated

      Only Skill Editor should read this.
      """
    而且 我不应该看到 Skill "agent-demo"
    当 我删除当前 Skill
    那么 我不应该看到 Skill "agent-demo-updated"
