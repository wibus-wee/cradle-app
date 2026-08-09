# language: zh-CN
@cradle
功能: 精华终端会话旅程
  作为用户，我希望在聊天页底部打开工作区终端，并看到真实命令输出

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-PTY-001
  场景: 可以在聊天页底部打开工作区终端并执行命令
    假如 我已配置 Claude Agent 多轮 Simulator
    而且 我已添加了一个工作区
    而且 我已在新建聊天页面发送了初始消息
    当 我打开底部终端面板
    那么 我应该看到底部终端面板
    当 我在底部终端中执行命令"pwd | shasum | awk '{print $1}'"
    那么 底部终端应显示当前工作区路径哈希
    而且 Simulator 脚本化交换应全部耗尽

  @essence @P1 @CRADLE-PTY-002
  场景: 多个终端会话同时存在时输入只进入当前活跃会话
    # 回归：多 PTY 挂载时若打到错误的 xterm helper textarea，输入会进错 session 或静默丢失。
    假如 我已配置 Claude Agent 多轮 Simulator
    而且 我已添加了一个工作区
    而且 我已在新建聊天页面发送了初始消息
    当 我打开底部终端面板
    那么 我应该看到底部终端面板
    而且 可见 shell-view 应恰好有 1 个
    当 我新建一个底部终端会话
    那么 底部终端应显示 2 个会话标签
    而且 底部终端第 2 个会话应处于活跃状态
    而且 可见 shell-view 应恰好有 1 个
    当 我在底部终端中执行命令"echo PTY_B_MARKER"
    那么 底部终端应显示文本"PTY_B_MARKER"
    当 我切换到底部终端第 1 个会话
    那么 底部终端第 1 个会话应处于活跃状态
    而且 可见 shell-view 应恰好有 1 个
    当 我在底部终端中执行命令"echo PTY_A_MARKER"
    那么 底部终端应显示文本"PTY_A_MARKER"
    而且 底部终端不应显示文本"PTY_B_MARKER"
    当 我切换到底部终端第 2 个会话
    那么 底部终端第 2 个会话应处于活跃状态
    而且 底部终端应显示文本"PTY_B_MARKER"
    而且 底部终端不应显示文本"PTY_A_MARKER"
    而且 Simulator 脚本化交换应全部耗尽
