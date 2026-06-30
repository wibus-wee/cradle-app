# language: zh-CN

@cradle
功能: 右侧 aside 面板
  作为用户，我希望在聊天上下文中通过右侧面板关联 Issue、查看等待源，并能跳转回对应业务视图

  背景:
    假如 应用已启动

  @P1 @CRADLE-ASIDE-001
  场景: 在右侧 Issue 面板关联已有 Issue 并打开详情
    假如 我已配置 Mock LLM Provider
    而且 我已添加了一个工作区
    而且 我已创建名为"Aside Issue Board"的看板
    而且 我已在第一列创建了一个 Issue"rightasideissue20260523 target"
    而且 我已导航到新建聊天页面
    当 我在新建聊天中选择当前工作区
    而且 我在新建聊天输入框中输入"right aside issue context session"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 最后一条 AI 消息应包含"Hello from mock LLM!"
    当 我打开右侧 aside
    而且 我切换右侧 aside 到"Issue"标签
    那么 右侧 Issue 面板应显示未关联状态
    当 我在右侧 Issue 面板关联 Issue"rightasideissue20260523 target"
    那么 右侧 Issue 面板应显示 Issue"rightasideissue20260523 target"
    当 我从右侧 Issue 面板打开当前 Issue
    那么 Issue 详情面板应显示
    而且 面板标题应为"rightasideissue20260523 target"

  @P1 @CRADLE-ASIDE-002
  场景: 右侧 Feed 面板显示 GitHub await composer 并可切换 review 模式
    假如 我已配置 Mock LLM Provider
    而且 我已添加了一个工作区
    而且 我已导航到新建聊天页面
    当 我在新建聊天中选择当前工作区
    而且 我在新建聊天输入框中输入"right aside feed context session"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 最后一条 AI 消息应包含"Hello from mock LLM!"
    当 我打开右侧 aside
    而且 我切换右侧 aside 到"Feed"标签
    那么 右侧 Feed 面板应显示 GitHub checks composer
    当 我将右侧 Feed composer 切换为 review
    那么 右侧 Feed composer 应显示 review 模式

  @P1 @CRADLE-ASIDE-003
  场景: 右侧 Files 面板显示当前聊天工作区文件并支持搜索
    假如 我已配置 Mock LLM Provider
    而且 我已添加了一个工作区
    而且 当前工作区中存在文件"src/rightasidefile20260523.ts"，内容为"export const marker = 'rightasidefile20260523'"
    而且 我已导航到新建聊天页面
    当 我在新建聊天中选择当前工作区
    而且 我在新建聊天输入框中输入"right aside files context session"
    而且 我点击发送按钮
    那么 应该跳转到聊天视图
    而且 最后一条 AI 消息应包含"Hello from mock LLM!"
    当 我打开右侧 aside
    而且 我切换右侧 aside 到"文件"标签
    那么 右侧 Files 面板应可用
    当 我在右侧 Files 面板搜索"rightasidefile20260523"
    那么 右侧 Files 面板应显示 1 个搜索结果
