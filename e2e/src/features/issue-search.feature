# language: zh-CN
@cradle @runtime-none
功能: Issue 全局搜索一致性
  作为用户，我希望通过全局搜索定位 Issue，并在重命名后立即看到一致结果

  背景:
    假如 应用已启动

  @essence @P1 @CRADLE-SEARCH-002
  场景: Issue 重命名使旧查询失效并保持新结果导航
    假如 我已通过 API 添加了一个工作区
    而且 我已创建名为"搜索一致性看板"的看板
    而且 我已在第一列创建了一个 Issue"search-original-20260904"
    当 我打开全局搜索对话框
    而且 我在全局搜索中搜索 Issue "search-original-20260904"
    那么 全局搜索中应该显示 Issue "search-original-20260904"
    当 我从全局搜索打开 Issue "search-original-20260904"
    那么 面板标题应为"search-original-20260904"
    当 我将 Issue 标题修改为"search-renamed-20260904"
    而且 我关闭 Issue 详情面板
    而且 我打开全局搜索对话框
    而且 我在全局搜索中搜索 Issue "search-original-20260904"
    那么 全局搜索中不应显示 Issue "search-original-20260904"
    而且 全局搜索应提示无匹配结果
    当 我在全局搜索中搜索 Issue "search-renamed-20260904"
    那么 全局搜索中应该显示 Issue "search-renamed-20260904"
    当 我从全局搜索打开 Issue "search-renamed-20260904"
    那么 面板标题应为"search-renamed-20260904"
    当 我重新加载并重新打开 Issue "search-renamed-20260904"
    那么 面板标题应为"search-renamed-20260904"
