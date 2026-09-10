# language: zh-CN
@cradle @runtime-none
功能: 工作区内置文件编辑器
  作为用户，我希望从工作区文件树编辑真实文件，并在刷新后继续看到已保存的内容

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-WORKSPACE-EDITOR-001
  场景: 从文件树编辑并保存文本文件后跨刷新恢复
    假如 我已通过 API 添加了一个工作区
    而且 当前工作区中存在文件"journey-11.txt"，内容为"initial editor content"
    当 我打开当前工作区的详情页
    而且 我从工作区文件树打开文件"journey-11.txt"
    那么 工作区内置编辑器应打开文件"journey-11.txt"
    而且 工作区内置编辑器应显示内容"initial editor content"
    而且 工作区内置编辑器状态应为"Saved"
    当 我将工作区内置编辑器内容替换为"persisted editor content"
    那么 工作区内置编辑器状态应为"Unsaved changes"
    当 我保存工作区内置编辑器中的文件"journey-11.txt"
    那么 工作区内置编辑器状态应为"Saved"
    而且 当前工作区文件"journey-11.txt"的磁盘内容应为"persisted editor content"
    当 我重新加载当前页面
    那么 工作区内置编辑器应打开文件"journey-11.txt"
    而且 工作区内置编辑器应显示内容"persisted editor content"
    而且 工作区内置编辑器状态应为"Saved"
    而且 当前工作区文件"journey-11.txt"的磁盘内容应为"persisted editor content"
