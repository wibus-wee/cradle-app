# language: zh-CN
@cradle @runtime-none
功能: 设置精华旅程
  作为用户，我希望本地设置经过刷新后仍保持一致，并能安全地切换服务器连接

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-SETTINGS-001
  场景: Appearance 主题在深色与浅色之间切换并跨刷新持久化
    当 我打开设置页
    而且 我点击"Appearance"设置导航项
    那么 我应该看到 Appearance 设置页面
    当 我选择外观主题"深色"
    那么 外观主题"深色"应处于选中状态
    而且 应用应切换到深色主题
    当 我重新加载当前页面
    那么 外观主题"深色"应处于选中状态
    而且 应用应切换到深色主题
    当 我选择外观主题"浅色"
    那么 外观主题"浅色"应处于选中状态
    而且 应用应切换到浅色主题
    当 我重新加载当前页面
    那么 外观主题"浅色"应处于选中状态
    而且 应用应切换到浅色主题

  @essence @P1 @CRADLE-SERVER-001
  场景: Server Endpoint 拒绝无效地址并在自定义连接与默认连接之间恢复
    当 我打开设置页
    而且 我点击"Server Endpoint"设置导航项
    那么 Server Endpoint 应显示默认的活动地址
    当 我输入无效的 Server Endpoint 地址
    而且 我尝试保存 Server Endpoint
    那么 Server Endpoint 应拒绝无效地址并保持默认连接
    当 我输入受管服务器的可达替代地址
    而且 我测试 Server Endpoint 连接
    那么 Server Endpoint 连接测试应成功
    当 我保存 Server Endpoint 并等待重新加载
    那么 Server Endpoint 应显示自定义的活动地址
    而且 应用应通过"自定义" Server Endpoint 完成启动
    当 我恢复默认 Server Endpoint 并等待重新加载
    那么 Server Endpoint 应显示默认的活动地址
    而且 应用应通过"默认" Server Endpoint 完成启动
