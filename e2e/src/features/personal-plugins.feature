# language: zh-CN
@cradle @runtime-claude
功能: Agent 创建的个人 Plugin 生命周期
  作为用户，我希望 Agent 创建的 Plugin 经过真实构建和不可变快照安装，
  并在原始聊天中按每个版本明确审查权限后才加载界面

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-PLUGIN-002
  场景: Agent 安装、审查、失败回滚并更新个人 Plugin
    假如 我已配置 Claude Agent 个人 Plugin 生命周期 Simulator
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天并选中 Simulator
    当 我在新建聊天输入框中输入"请创建并安装个人 Plugin"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 最后一条 AI 消息应包含"个人 Plugin 已构建并安装"
    而且 聊天流应结束于空闲状态
    而且 原始聊天应显示个人 Plugin 权限审查
    而且 个人 Plugin 应安装为未授权的不可变 v1 快照
    当 我在原始聊天中审查并激活个人 Plugin
    那么 个人 Plugin v1 面板应可见
    而且 个人 Plugin v1 应记录精确权限授权
    当 我返回个人 Plugin 的原始聊天
    当 我在聊天输入框中发送"请验证个人 Plugin 更新失败时保留旧版本"
    那么 最后一条 AI 消息应包含"已安装的 v1 快照保持可用"
    而且 聊天流应结束于空闲状态
    而且 个人 Plugin v1 快照与授权应保持不变
    而且 个人 Plugin v1 面板应可见
    当 我返回个人 Plugin 的原始聊天
    当 我在聊天输入框中发送"请将个人 Plugin 更新到 v2"
    那么 最后一条 AI 消息应包含"个人 Plugin v2 已发布为新快照"
    而且 聊天流应结束于空闲状态
    而且 原始聊天应再次显示个人 Plugin 权限审查
    而且 个人 Plugin 新快照应替换 v1 并撤销旧授权
    而且 个人 Plugin 面板应不可见
    当 我在原始聊天中审查并激活个人 Plugin
    那么 个人 Plugin v2 面板应可见
    而且 个人 Plugin v2 应记录精确权限授权
    当 我重新加载当前页面
    那么 个人 Plugin v2 面板应可见
    当 我返回个人 Plugin 的原始聊天
    而且 原始聊天不应再显示个人 Plugin 权限审查
    而且 Simulator 脚本化交换应全部耗尽
