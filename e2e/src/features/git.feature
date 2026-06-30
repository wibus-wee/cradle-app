# language: zh-CN
@cradle
功能: Git 集成
  作为在 Git 仓库中工作的用户，我希望通过真实聊天工作流查看当前分支、切换分支，并在右侧 Git 面板看到真实提交图

  背景:
    假如 应用已启动
    而且 我已配置 Mock LLM Provider

  @P1 @CRADLE-GIT-001
  场景: 通过真实聊天进入 chat tab 后 Header 会显示当前分支并可打开 branch picker
    假如 我已添加了一个真实 Git 工作区
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

  @P1 @CRADLE-GIT-002
  场景: 我可以在 branch picker 中创建并切换到新分支，且 Header 与 Git 面板会同步更新
    假如 我已添加了一个真实 Git 工作区
    而且 我已导航到新建聊天页面
    而且 我在新建聊天中选择 Git 工作区
    当 我在新建聊天输入框中输入"git-create-and-switch-branch"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    当 我打开 Chat Header 中的 Git 分支选择器
    而且 我在分支选择器中开始创建新分支
    而且 我在分支选择器中输入新分支名 "feature/e2e-switch"
    而且 我确认创建并切换分支
    那么 Chat Header 中应该显示 Git 分支 "feature/e2e-switch"
    而且 当前 Git 工作区应处于分支 "feature/e2e-switch"
    当 我打开右侧 Aside
    而且 我切换到右侧 Aside 的 Git 标签
    那么 Git 面板应该显示当前分支 "feature/e2e-switch"

  @P1 @CRADLE-GIT-003
  场景: 打开右侧 Aside 的 Git 标签时会渲染真实提交图
    假如 我已添加了一个真实 Git 工作区
    而且 我已导航到新建聊天页面
    而且 我在新建聊天中选择 Git 工作区
    当 我在新建聊天输入框中输入"git-render-commit-graph"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    当 我打开右侧 Aside
    而且 我切换到右侧 Aside 的 Git 标签
    那么 Git 提交图应该已渲染
    而且 Git 提交图中应该包含提交 "main: third commit"
    而且 Git 提交图中应该包含提交 "seed: branch commit"
