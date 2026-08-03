# language: zh-CN
@cradle
功能: 设置精华旅程
  作为用户，我希望在 Settings 中调整外观并复制反馈模板

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-SETTINGS-001
  场景: Appearance 主题在深色与浅色之间往返切换
    当 我打开设置页
    而且 我点击"Appearance"设置导航项
    那么 我应该看到 Appearance 设置页面
    当 我选择外观主题"深色"
    那么 外观主题"深色"应处于选中状态
    而且 应用应切换到深色主题
    当 我选择外观主题"浅色"
    那么 外观主题"浅色"应处于选中状态
    而且 应用应切换到浅色主题

  @essence @P1 @CRADLE-SETTINGS-002
  场景: Support 设置可复制反馈模板到剪贴板
    当 我打开设置页
    而且 我点击"Support"设置导航项
    那么 我应该看到 Support 设置页面
    当 我复制 Support 反馈模板
    那么 剪贴板中应包含文本"# Cradle Preview Feedback"
    而且 Support 设置状态应显示"Feedback template copied."
