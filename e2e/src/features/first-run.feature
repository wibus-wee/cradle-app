# language: zh-CN
@cradle @runtime-claude
功能: 首次启动到第一条真实回复
  作为首次安装 Cradle 的用户，我希望不依赖 API 预置完成 Provider、工作区和第一次聊天

  @first-run @essence @P0 @CRADLE-FIRST-RUN-001
  场景: 干净安装通过 UI 完成首次设置并收到第一条 Claude Agent 回复
    假如 应用已启动
    而且 我已为首次启动准备 Claude Agent Simulator
    那么 我应该看到品牌首次启动页
    当 我完成品牌首次启动页
    而且 我在首次设置中创建 Simulator Provider
    而且 我跳过 GitHub 并完成首次设置
    而且 我通过原生对话框添加工作区
    而且 我点击"新建聊天"导航项
    而且 我选择首次启动创建的 Claude Agent Provider
    而且 我在新建聊天输入框中输入"首次启动后的第一条消息"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 最后一条 AI 消息应包含"首次启动链路已完成"
    而且 聊天流应结束于空闲状态
    当 我重新加载当前页面
    那么 首次启动设置应保持完成
    而且 Simulator 脚本化交换应全部耗尽
