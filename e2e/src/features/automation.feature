# language: zh-CN
@cradle @runtime-claude
功能: Automation Agent 执行生命周期
  作为用户，我希望 Automation 通过真实 Agent 生成可审阅的会话与产物

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-AUTO-001
  场景: 手动运行 Automation 后审阅产物、处理 Triage 并打开关联会话
    假如 我已配置 Automation 报告 Claude Agent Simulator
    而且 我已添加了一个工作区
    而且 当前工作区已有一个 Automation 定义
    当 我打开 Automations 页面并选中该定义
    而且 我手动运行该 Automation
    那么 Automation 应生成待审阅的成功运行
    而且 Automation 运行产物应包含 Agent 报告
    当 我将该 Automation 运行标记为已解决
    那么 Automation Triage 应不再显示该运行
    当 我重新加载当前页面
    那么 Automation 的成功运行与产物应保持可见
    而且 Automation Triage 应不再显示该运行
    当 我从工作区侧栏打开 Automation 生成的会话
    那么 Automation 会话应显示同一份 Agent 报告
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-AUTO-002
  场景: 重载运行中的 Automation 后停止关联会话并保留取消审计状态
    假如 我已配置可取消的 Automation Claude Agent Simulator
    而且 我已添加了一个工作区
    而且 当前工作区已有一个 Automation 定义
    当 我打开 Automations 页面并选中该定义
    而且 我启动该 Automation 并等待 Agent 响应进入门控
    而且 我重新加载当前页面
    那么 重新加载后应显示可停止的 Automation 运行
    当 我停止该 Automation 运行
    那么 Automation 应显示待审阅的已取消运行且没有产物
    当 我重新加载当前页面
    那么 Automation 的已取消运行应在重载后保持一致
    当 我打开已取消 Automation 的关联会话
    那么 已取消 Automation 会话不应包含迟到回复
    而且 已取消 Automation 的 Provider 门控应已取消
    而且 Simulator 脚本化交换应全部耗尽
