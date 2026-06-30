<!-- Once this directory changes, update this README.md -->

# Features/Devtool/Plugins

Devtool plugins 面板展示插件发现结果、运行层状态、React Flow 拓扑图、声明能力/权限、运行时 capability、客户端 panel 注册和 command 注册。

## Files

- **plugin-graph.tsx**: React Flow 插件拓扑图，展示 server / web / desktop 运行层、插件节点、声明能力、运行时 capability、权限、客户端贡献和 warning/error 节点；支持缩放、拖拽、MiniMap 和选中节点详情。
- **plugins-panel.tsx**: 插件 devtool 主面板，展示插件列表、层状态、声明能力/权限、客户端注册项，并为 command execution 按钮提供按命令命名的可访问名称。
- **plugins-panel.test.tsx**: 回归测试，覆盖客户端 command 和插件归属 command 的可访问执行按钮语义。
- **use-plugin-data.ts**: 插件发现数据 hook，负责调用 server plugin endpoint、刷新可见页面数据，并记录插件 activation 时间。
