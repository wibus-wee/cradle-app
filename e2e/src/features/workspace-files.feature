# language: zh-CN
@cradle
功能: 工作区文件浏览与编辑用户旅程

  作为用户，我希望在右侧 Files 面板浏览、搜索、打开、编辑工作区文件，并把文件拖入 Composer

  背景:
    假如 应用已启动

  @P0 @CRADLE-JOURNEY-005
  场景: 在右侧 Files 面板搜索并打开文件到编辑器
    假如 我已添加了一个包含 AGENTS.md 的工作区
    当 我打开当前工作区的详情页
    而且 我打开右侧 aside
    而且 我切换右侧 aside 到"Files"标签
    当 我在右侧 Files 面板搜索"AGENTS"
    那么 右侧 Files 面板应显示 1 个搜索结果
    当 我双击搜索结果中的"AGENTS.md"
    那么 文件编辑器应打开"AGENTS.md"
    而且 编辑器内容应包含工作区原始内容

  @P1 @CRADLE-JOURNEY-006
  场景: 编辑文件后保存并看到文件树刷新
    假如 我已添加了一个包含 AGENTS.md 的工作区
    而且 我已在编辑器中打开"AGENTS.md"
    当 我在编辑器中将内容修改为"# Updated by Journey"
    而且 我保存文件
    那么 右侧 Files 面板应显示"AGENTS.md"标记为已修改
    当 我重新加载当前页面
    而且 我打开右侧 aside
    而且 我切换右侧 aside 到"Files"标签
    那么 右侧 Files 面板应能找到"AGENTS.md"且文件内容包含"# Updated by Journey"