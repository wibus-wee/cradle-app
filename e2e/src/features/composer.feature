# language: zh-CN
@cradle
功能: 精华 Composer 旁路
  作为用户，我希望用 !bang 在 Composer 中进入本地命令模式

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-COMP-003
  场景: Composer 执行 bang 命令、持久化输出并在刷新后恢复
    假如 我已配置 Claude Agent Simulator Provider（不预置回复）
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天并选中 Simulator
    当 我在新建聊天输入框中输入"!printf hello-from-bang"
    那么 Composer 应显示 bang 命令预览
    当 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 聊天视图应显示 bang 结果，包含"hello-from-bang"
    当 我重新加载当前页面
    那么 聊天视图应显示 bang 结果，包含"hello-from-bang"
    而且 Simulator 脚本化交换应全部耗尽
