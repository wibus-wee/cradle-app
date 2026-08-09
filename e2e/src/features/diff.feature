# language: zh-CN
@cradle
功能: 本地变更审查与提交
  作为用户，我希望 Diffs 反映真实 Git working tree，并能在源文件变化后刷新到最新内容

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-DIFF-001
  场景: 从 Diffs 审查真实未提交内容并刷新外部变化
    假如 我已添加了一个真实 Git 工作区
    而且 真实 Git 工作区中存在未提交文件"review-me.txt"，内容为"real diff review content"
    当 我打开 Diffs
    而且 我打开 Working tree
    那么 Working tree 应显示未提交文件"review-me.txt"
    而且 Working tree diff 应包含"real diff review content"
    当 外部进程把"refreshed diff content"追加到未提交文件"review-me.txt"
    而且 我刷新 Working tree review
    那么 Working tree diff 应包含"refreshed diff content"
    而且 真实 Git 仓库仍应保留该未提交变更
