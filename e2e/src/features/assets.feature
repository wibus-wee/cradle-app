# language: zh-CN
@cradle @runtime-none
功能: Issue 描述图片资产持久化
  作为用户，我希望在 Issue 描述中上传图片后，Cradle 保存并持续显示同一份资产

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-ASSET-001
  场景: 上传到 Issue 描述的图片在保存和刷新后保持可见
    假如 我已通过 API 添加了一个工作区
    而且 我已创建名为"资产看板"的看板
    而且 我已在第一列创建了一个 Issue"图片资产 Issue"
    当 我点击名为"图片资产 Issue"的 Issue 卡片
    而且 我在当前 Issue 描述中上传示例图片
    那么 当前 Issue 描述应显示已保存的示例图片
    当 我重新加载并重新打开 Issue "图片资产 Issue"
    那么 当前 Issue 描述应继续显示同一张示例图片
