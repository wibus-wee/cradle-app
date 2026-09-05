# language: zh-CN
@cradle @runtime-none
功能: 外部会话导入
  作为用户，我希望将本机 Claude 历史恢复为 Cradle 会话，同时保持外部源只读且避免重复导入

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-IMPORT-001
  场景: 扫描并导入 Claude 会话后跨刷新保留内容且阻止重复导入
    假如 本机存在一段可导入的外部 Claude 会话历史
    当 我从 Import 设置扫描外部会话
    而且 我选择并导入该 Claude 会话
    那么 我可以从导入结果打开完整会话
    而且 刷新后导入的会话与消息应保持不变
    而且 重新扫描应阻止重复导入且不修改外部源文件
