# language: zh-CN
@cradle @runtime-none
功能: Issue 批量分诊生命周期
  作为用户，我希望一次更新多个 Issue，并在刷新后继续看到一致的优先级与状态

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-ISSUE-BULK-001
  场景: 批量优先级与状态更新清理选择并跨刷新持久化
    假如 我已通过 API 添加了一个工作区
    而且 我已创建名为"批量分诊看板"的看板
    而且 我已在第一列创建了一个 Issue"修复登录回归"
    而且 我已在第一列创建了一个 Issue"补齐发布说明"
    当 我选择 Issue "修复登录回归"
    而且 我选择 Issue "补齐发布说明"
    那么 看板应显示 2 个已选 Issue
    当 我将已选 Issue 的优先级批量修改为"Urgent"
    那么 看板不应显示已选 Issue
    而且 名为"修复登录回归"的卡片应显示优先级"Urgent"
    而且 名为"补齐发布说明"的卡片应显示优先级"Urgent"
    当 我选择 Issue "修复登录回归"
    而且 我选择 Issue "补齐发布说明"
    而且 我将已选 Issue 批量移动到"In Progress"列
    那么 看板不应显示已选 Issue
    而且 名为"修复登录回归"的 Issue 卡片应显示在名为"In Progress"的列中
    而且 名为"补齐发布说明"的 Issue 卡片应显示在名为"In Progress"的列中
    当 我重新加载当前看板
    那么 名为"修复登录回归"的卡片应显示优先级"Urgent"
    而且 名为"补齐发布说明"的卡片应显示优先级"Urgent"
    而且 名为"修复登录回归"的 Issue 卡片应显示在名为"In Progress"的列中
    而且 名为"补齐发布说明"的 Issue 卡片应显示在名为"In Progress"的列中
