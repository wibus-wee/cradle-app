# language: zh-CN
@cradle @runtime-none
功能: 本地 ACP Runtime 配置
  作为用户，我希望在本机配置 ACP Runtime，并确认其启动参数能跨刷新更新和删除

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-ACP-001
  场景: 校验、创建、更新并删除本地 ACP Runtime
    当 我打开设置页
    而且 我点击"Runtimes"设置导航项
    那么 Runtimes 设置页面应已就绪
    当 我开始添加本地 ACP Runtime
    而且 我输入包含无效环境变量行的本地 ACP 配置
    那么 本地 ACP 配置应指出第 2 行无效且无法保存
    当 我修正环境变量并保存本地 ACP Runtime
    那么 本地 ACP Runtime 应以规范化配置创建成功
    当 我重新加载当前页面
    那么 Runtimes 设置页面应已就绪
    当 我选择已创建的本地 ACP Runtime
    那么 本地 ACP Runtime 应恢复已保存的规范化配置
    当 我更新并保存本地 ACP Runtime 配置
    那么 本地 ACP Runtime 应显示更新成功
    当 我重新加载当前页面
    那么 Runtimes 设置页面应已就绪
    当 我选择已更新的本地 ACP Runtime
    那么 本地 ACP Runtime 应恢复更新后的配置
    当 我删除本地 ACP Runtime
    那么 本地 ACP Runtime 应从列表中移除
    当 我重新加载当前页面
    那么 Runtimes 设置页面应已就绪
    而且 本地 ACP Runtime 应保持已删除状态
