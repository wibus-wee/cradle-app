# language: zh-CN
@cradle @runtime-none
功能: 会话归档与恢复
  作为用户，我希望暂时隐藏不活跃的会话，并能从设置中可靠找回完整对话

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-SESSION-ARCHIVE-001
  场景: 归档会话可搜索、跨刷新保持并恢复完整对话
    假如 本机存在一段可导入的外部 Claude 会话历史
    当 我从 Import 设置扫描外部会话
    而且 我选择并导入该 Claude 会话
    那么 我可以从导入结果打开完整会话
    当 我将当前会话重命名为"Restorable Archived Session"
    那么 当前会话标题应为"Restorable Archived Session"
    当 我归档当前会话"Restorable Archived Session"
    那么 侧栏中不应显示恢复目标会话
    当 我打开设置页
    而且 我点击"Chat"设置导航项
    那么 我应该看到 Chat 设置页面
    而且 已归档会话中应显示恢复目标会话"Restorable Archived Session"
    当 我搜索已归档会话"不存在的归档标题"
    那么 已归档会话应显示无匹配结果
    当 我搜索已归档会话"Restorable Archived Session"
    那么 已归档会话中应显示恢复目标会话"Restorable Archived Session"
    当 我重新加载当前页面
    那么 已归档会话中应显示恢复目标会话"Restorable Archived Session"
    当 我恢复目标会话"Restorable Archived Session"
    那么 已归档会话应为空
    当 我关闭设置并返回首页
    那么 侧栏应显示恢复目标会话
    当 我从侧栏打开恢复目标会话
    那么 我应该看到用户消息"Audit the imported release transcript"
    而且 最后一条 AI 消息应包含"Imported transcript marker CRADLE_EXTERNAL_IMPORT_7F3A"
    当 我重新加载当前页面
    那么 当前会话标题应为"Restorable Archived Session"
    而且 我应该看到用户消息"Audit the imported release transcript"
    而且 最后一条 AI 消息应包含"Imported transcript marker CRADLE_EXTERNAL_IMPORT_7F3A"
