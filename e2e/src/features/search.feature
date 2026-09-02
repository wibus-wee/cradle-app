# language: zh-CN
@cradle @runtime-claude
功能: 精华全局搜索旅程
  作为用户，我希望通过全局搜索按标题定位会话并打开，且能用命令打开设置

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-SEARCH-001
  场景: 按会话标题搜索并打开对应会话
    假如 我已配置 Claude Agent 多轮 Simulator
    而且 我已添加了一个工作区
    当 我新建一个聊天会话并记住为"标题目标会话"，首条消息为"titlesearchtarget20260506 session"
    而且 我新建一个聊天会话并记住为"当前会话"，首条消息为"other session before search"
    而且 我打开全局搜索对话框
    而且 我在全局搜索中输入"titlesearchtarget20260506"
    那么 全局搜索中应该显示会话"标题目标会话"的标题高亮"titlesearchtarget20260506"
    当 我从全局搜索打开会话"标题目标会话"
    那么 当前聊天视图应该打开会话"标题目标会话"
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-SEARCH-003
  场景: 从全局搜索命令打开 Settings
    当 我打开全局搜索对话框
    而且 我在全局搜索中输入">settings"
    那么 全局搜索命令"Open settings"应可见
    当 我从全局搜索执行命令"Open settings"
    那么 侧边栏应处于设置模式
    而且 我应该看到 Appearance 设置页面
