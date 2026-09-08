# language: zh-CN
@cradle @runtime-claude
功能: Workspace Skill 生命周期进入真实 Agent 请求
  作为用户，我希望 Workspace Skill 从创建、调用到删除都与 Agent 和会话状态一致，而不是只改变管理列表

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-SKILL-001
  场景: 创建 Workspace Skill 后调用真实 Agent，删除后停止新调用但保留会话证据
    假如 我已配置会校验 Workspace Skill 的 Claude Agent Simulator
    而且 我已添加了一个工作区
    而且 我通过 Workspace Skills 创建了发布判断 Skill
    当 我在新建聊天中选择并调用该 Workspace Skill
    那么 Claude Agent 应返回 Workspace Skill 的脚本化结果
    而且 聊天流应结束于空闲状态
    而且 刷新后 Skill 调用应保留在历史消息中
    当 我从 Workspace Skills 删除该 Skill
    那么 刷新后新聊天不应再提供该 Skill
    而且 已完成会话仍应保留该 Skill 的调用证据
    而且 Simulator 脚本化交换应全部耗尽
