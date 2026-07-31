# language: zh-CN
@cradle
功能: 精华 Git 集成旅程
  作为在 Git 仓库中工作的用户，我希望通过真实聊天工作流查看当前分支并可打开 branch picker

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-GIT-001
  场景: 通过真实聊天进入 chat tab 后 Header 显示当前分支并可打开 branch picker
    假如 我已配置 Claude Agent 多轮 Simulator
    而且 我已添加了一个真实 Git 工作区
    而且 我已导航到新建聊天页面
    而且 我在新建聊天中选择 Git 工作区
    当 我在新建聊天输入框中输入"git-header-branch-control"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 Chat Header 中应该显示当前 Git 分支
    当 我打开 Chat Header 中的 Git 分支选择器
    那么 我应该看到 Git 分支选择器
    而且 Git 分支选择器中应该包含本地分支 "main"
    而且 Git 分支选择器中应该包含本地分支 "seed-branch"
