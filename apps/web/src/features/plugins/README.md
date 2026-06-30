# Plugins Feature

插件功能负责把已注册的 web plugin panel 暴露到应用侧栏，并保持 panel 入口归属于 Cradle app shell，而不是具体插件实现。

- **plugins-sidebar.tsx**: Renders sidebar entries for web plugin panels registered through the plugin store, with stable E2E anchors keyed by local panel id.
