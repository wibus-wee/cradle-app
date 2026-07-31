# language: zh-CN

@cradle
功能: 全局搜索中的线程搜索
  作为用户，我希望通过真实的全局搜索入口按标题或消息内容定位会话，并直接打开对应会话

  背景:
    假如 应用已启动

  @P1 @CRADLE-SEARCH-001
  场景: 按会话标题搜索时显示标题高亮并打开对应会话
    假如 我已配置 Mock LLM Provider
    而且 我已添加了一个工作区
    当 我新建一个聊天会话并记住为"标题目标会话"，首条消息为"titlesearchtarget20260506 session"
    而且 我新建一个聊天会话并记住为"当前会话"，首条消息为"other session before search"
    而且 我打开全局搜索对话框
    而且 我在全局搜索中输入"titlesearchtarget20260506"
    那么 全局搜索中应该显示会话"标题目标会话"的标题高亮"titlesearchtarget20260506"
    当 我从全局搜索打开会话"标题目标会话"
    那么 当前聊天视图应该打开会话"标题目标会话"

  @P1 @CRADLE-SEARCH-002
  场景: 按消息内容搜索时显示高亮片段并打开对应会话
    假如 我已配置 Mock LLM Provider
    而且 我已添加了一个工作区
    当 我新建一个聊天会话并记住为"内容目标会话"，首条消息为"plain title for snippet journey"
    而且 我在聊天输入框中输入"snippettarget20260506 message body"
    而且 我点击聊天发送按钮
    那么 最后一条 AI 消息应包含"Hello from mock LLM!"
    而且 我新建一个聊天会话并记住为"当前会话"，首条消息为"other session after snippet"
    当 我打开全局搜索对话框
    而且 我在全局搜索中输入"snippettarget20260506"
    那么 全局搜索中应该显示会话"内容目标会话"的消息片段高亮"snippettarget20260506"
    当 我从全局搜索打开会话"内容目标会话"
    那么 当前聊天视图应该打开会话"内容目标会话"

  @P1 @CRADLE-SEARCH-003
  场景: 从全局搜索命令打开 Settings
    当 我打开全局搜索对话框
    而且 我在全局搜索中输入">设置"
    那么 全局搜索命令"打开设置"应可见
    当 我从全局搜索执行命令"打开设置"
    那么 侧边栏应处于设置模式
    而且 我应该看到 Appearance 设置页面

  @P1 @CRADLE-SEARCH-004
  场景: 从全局搜索命令打开 Usage Dashboard
    当 我打开全局搜索对话框
    而且 我在全局搜索中输入">用量"
    那么 全局搜索命令"用量统计"应可见
    当 我从全局搜索执行命令"用量统计"
    那么 我应该看到 Usage Dashboard
    而且 Usage Dashboard 应显示空状态

  @P1 @CRADLE-SEARCH-005
  场景: 从全局搜索命令新建对话
    当 我打开全局搜索对话框
    而且 我在全局搜索中输入">新建"
    那么 全局搜索命令"新建对话"应可见
    当 我从全局搜索执行命令"新建对话"
    那么 我应该看到新建聊天页面

  @P1 @CRADLE-SEARCH-006
  场景: 从全局搜索命令切换侧栏
    假如 应用 shell 已加载
    而且 侧边栏应处于展开状态
    当 我打开全局搜索对话框
    而且 我在全局搜索中输入">侧栏"
    那么 全局搜索命令"切换侧栏"应可见
    当 我从全局搜索执行命令"切换侧栏"
    那么 侧边栏应处于折叠状态

  @P1 @CRADLE-SEARCH-007
  场景: 从全局搜索打开 Issue 所在看板
    假如 我已添加了一个工作区
    而且 我已创建名为"Search Issue Board"的看板
    而且 我已在第一列创建了一个 Issue"globalsearchissue20260523 target"
    当 我打开全局搜索对话框
    而且 我在全局搜索中输入"globalsearchissue20260523"
    那么 全局搜索中应该显示 Issue 结果"globalsearchissue20260523 target"
    当 我从全局搜索打开 Issue 结果"globalsearchissue20260523 target"
    那么 Issue 详情面板应显示
    而且 面板标题应为"globalsearchissue20260523 target"

  @P1 @CRADLE-SEARCH-008
  场景: 从聊天上下文的全局搜索打开文件结果
    假如 我已配置 Mock LLM Provider
    而且 我已添加了一个工作区
    而且 当前工作区中存在文件"src/globalsearchfile20260523.ts"，内容为"export const marker = 'globalsearchfile20260523'"
    而且 我已导航到新建聊天页面
    当 我在新建聊天中选择当前工作区
    而且 我在新建聊天输入框中输入"file search context session"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 最后一条 AI 消息应包含"Hello from mock LLM!"
    而且 我打开全局搜索对话框
    而且 我在全局搜索中输入"globalsearchfile20260523"
    那么 全局搜索中应该显示文件结果"src/globalsearchfile20260523.ts"
    当 我从全局搜索打开文件结果"src/globalsearchfile20260523.ts"
    那么 当前工作区详情页应该打开
    而且 剪贴板应该包含文件路径"src/globalsearchfile20260523.ts"

  @P1 @CRADLE-SEARCH-009
  场景: 可以通过 Escape 关闭全局搜索并留在当前页面
    那么 我应该看到首页仪表盘
    当 我打开全局搜索对话框
    而且 我在全局搜索中输入"不存在的搜索目标"
    而且 我按下 Escape 关闭全局搜索
    那么 全局搜索对话框应关闭
    而且 我应该看到首页仪表盘
