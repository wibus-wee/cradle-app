# language: zh-CN
@cradle
功能: 插件面板

  作为用户，我可以从侧栏打开插件提供的面板并刷新真实数据

  @P1 @CRADLE-PLUGINS-001
  场景: 打开 System Info 插件面板并刷新
    当 我打开 System Info 插件面板
    那么 System Info 面板应显示系统信息
    当 我刷新 System Info 面板
    那么 System Info 面板应继续显示系统信息

  @P1 @CRADLE-PLUGINS-002
  场景: 从插件面板返回首页后重新激活 System Info 面板
    当 我打开 System Info 插件面板
    那么 System Info 面板应显示系统信息
    当 我点击首页导航项
    那么 我应该看到首页仪表盘
    当 我打开 System Info 插件面板
    那么 System Info 面板应显示系统信息
