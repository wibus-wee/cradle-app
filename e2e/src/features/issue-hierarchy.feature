# language: zh-CN
@cradle @runtime-none
功能: Issue 父子层级生命周期
  作为用户，我希望父子 Issue 在看板与详情之间保持一致，并能安全删除子任务

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-ISSUE-HIERARCHY-001
  场景: 子 Issue 跨刷新保持双向导航并在删除后清理父级投影
    假如 我已通过 API 添加了一个工作区
    而且 我已创建名为"层级看板"的看板
    而且 我已在第一列创建了一个 Issue"发布父任务"
    当 我点击名为"发布父任务"的 Issue 卡片
    而且 我在当前 Issue 下添加子 Issue"验证子任务"
    那么 子 Issue 列表应显示"验证子任务"
    而且 当前 Issue 的子 Issue 进度应为"0/1 done"
    当 我重新加载并重新打开 Issue "发布父任务"
    那么 子 Issue 列表应显示"验证子任务"
    而且 当前 Issue 的子 Issue 进度应为"0/1 done"
    当 我关闭 Issue 详情面板
    那么 该列应显示一张名为"验证子任务"的卡片
    当 我从子 Issue "验证子任务"卡片的父链接打开 Issue "发布父任务"
    那么 面板标题应为"发布父任务"
    当 我从当前 Issue 打开子 Issue "验证子任务"
    那么 面板标题应为"验证子任务"
    而且 当前 Issue 应显示父 Issue "发布父任务"链接
    当 我通过父 Issue 链接打开 Issue "发布父任务"
    那么 子 Issue 列表应显示"验证子任务"
    当 我从当前 Issue 打开子 Issue "验证子任务"
    而且 我删除当前打开的 Issue
    那么 该看板不应显示名为"验证子任务"的卡片
    当 我重新加载并重新打开 Issue "发布父任务"
    那么 当前 Issue 应不再显示子 Issue
