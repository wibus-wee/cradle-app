# language: zh-CN
@cradle @runtime-none
功能: 会话归档导出
  作为用户，我希望将恢复到 Cradle 的历史会话重新导出为可移植且内容完整的 ZIP 归档

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-SESSION-EXPORT-001
  场景: 导入的完整会话跨刷新后可下载为同一份 JSON 与 Markdown 归档
    假如 本机存在一段可导入的外部 Claude 会话历史
    当 我从 Import 设置扫描外部会话
    而且 我选择并导入该 Claude 会话
    那么 我可以从导入结果打开完整会话
    当 我将当前会话重命名为"Portable Session Export"
    而且 我重新加载当前页面
    那么 当前会话标题应为"Portable Session Export"
    而且 我应该看到用户消息"Audit the imported release transcript"
    而且 最后一条 AI 消息应包含"Imported transcript marker CRADLE_EXTERNAL_IMPORT_7F3A"
    当 我从当前会话菜单导出 ZIP
    那么 下载的会话 ZIP 应匹配当前会话身份和确定性文件名
    而且 下载的会话 ZIP 应只包含完整 JSON 与 Markdown 记录
    而且 导出后当前会话和消息应保持不变
