# language: zh-CN
@cradle @P0
功能: 首页仪表盘

  作为用户
  我希望打开应用时看到首页
  包含最近活动和快速操作

  背景:
    假如 应用已启动

  @CRADLE-HOME-001
  场景: 应用启动后展示首页仪表盘
    那么 我应该看到首页仪表盘

  @CRADLE-HOME-002
  场景: 从首页进入最近会话
    假如 我已配置 Mock LLM Provider
    而且 存在至少一个会话
    当 我点击最近会话卡片
    那么 应该切换到对应的聊天标签页

  @CRADLE-HOME-003
  场景: 从侧栏进入 Automation Dashboard 并返回首页
    假如 我已配置 Mock LLM Provider
    而且 存在至少一个会话
    当 我从侧栏打开 Automation Dashboard
    那么 我应该看到 Automation Dashboard
    而且 Automation Dashboard 应显示空状态
    当 我刷新 Automation Dashboard
    那么 我应该看到 Automation Dashboard
    而且 Automation Dashboard 应显示空状态
    当 我从 Automation Dashboard 返回首页
    那么 我应该看到首页仪表盘
