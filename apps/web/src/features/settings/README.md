<!-- Once this directory changes, update this README.md -->

# Features/Settings

应用设置模块负责渲染全局配置页面。
设置页由 TanStack Router 的 `/settings/$section` route 展示；侧边栏只处理 section 导航，具体设置能力由各 feature 页面承载。
新增设置分类时，应同步维护导航映射与本目录的文件清单。

## Files

- **appearance-settings.tsx**: 外观设置页，负责主题切换；Settings Appearance 首屏在 theme options ready 后记录 performance gate；主题选项暴露稳定 E2E selection anchors。AI 回复流式动画不再暴露设置项，由 Streamdown store 固定为逐字、balanced、关闭 cursor。
- **about-settings.tsx**: 关于设置页，使用紧凑 Settings row 布局说明 Cradle-owned Application Support 数据目录，并明确列出用户确认或显式操作后可能写入 Application Support 外的 workspace、skills、provider-native skill roots 与 CLI command 路径。
- **chat-settings.tsx**: 对话设置页，负责默认 continuation behavior、Codex app-server Cradle User-Agent 开关的切换，并在 Chat section header 下方展示 session-owned archived sessions 列表、归档搜索与 restore 操作；restore response 会保留 session 列表使用的 latest-user-message activity timestamp。
- **chronicle-settings.tsx**: 由 `features/chronicle` 拥有的 Settings > 记录页面；Settings Chronicle 首屏在 Chronicle config、status、resources、message sources、evidence、activity、knowledge、timeline、memories 和当前 profile 的 Agent Runtime model cache 首轮数据 ready 后记录 performance gate。
- **desktop-update-settings.tsx**: Desktop 设置页（preferences-first 布局）。主区是 desktop-owned 偏好开关：Double Command+Q 退出、自动检查更新、自动下载更新；保存后通过 Electron IPC 立即同步 quit guard 与 desktop preferences。仅在 Electron 下，偏好下方再以紧凑卡片承载 Cradle desktop updater 的检查、下载、重启安装状态与 packaged macOS `cradle` PATH command 的 install/repair/remove 入口；Web 端只显示「仅桌面应用生效」提示。Settings Desktop 首屏在 update status 与 CLI status 初始化完成后记录 performance gate。
- **external-issue-source-settings.tsx**: GitHub Issues 设置页，通过 Cradle-owned `/external-issue-sources` API 管理 workspace 仓库绑定、手动刷新、启停、每小时调度开关和删除；插件只注册 source reader，不贡献 Settings UI。
- **external-work-import-settings.tsx**: Import 设置页，只扫描 Server 与 Electron 设备上的 Claude / Codex 会话文件，合并去重后提交到 Server 导入为 Cradle-owned chat sessions。
- **feature-settings.tsx**: Features 设置页，编辑 server-owned App feature flags，包括是否允许 Cradle 写入 Codex/Claude provider-native skill roots；前端入口只读取这些 flags，不拥有门控语义。
- **jarvis-settings.tsx**: Jarvis 设置页，复用 composer toolbar 的 runtime/provider/model/thinking 级联选择器配置系统助手模型；runtime list comes from Chat Runtime catalog filtered to `jarvis` surfaces, and Settings Jarvis 首屏在 preferences、provider targets 与当前 provider target cached models 查询成功后记录 performance gate
- **model-registry-settings.tsx**: 全局模型 registry mappings 设置页，管理 Cradle-owned model ID 到 models.dev/manual registry entry 的映射，供所有 provider target 与 custom model 统一 enrichment；采用居中列表布局（`SettingsPage` + 列表卡片），每个 mapping 一行内联展示 registry ID、family、context window 与 cost，编辑复用 `ModelRegistryMappingDialog`，删除内联。
- **network-settings.tsx**: 导出 `ProxySettingsGroup`，嵌入 Network 设置页（与 Server Endpoint 合并）的紧凑代理分组卡片：启用开关、来源下拉（Follow System / Custom / Environment）、条件出现的 Custom URL 与当前解析状态行。编辑 server-owned outbound proxy preferences，前端只写 Cradle preferences，不直接读写系统代理。
- **settings-overlay-store.ts**: (moved to `~/store/settings-overlay.ts`) Shared Settings focus state — records active section selection and one-shot Chronicle memory/knowledge and Agent focus targets for Settings-owned panels; Settings visibility is owned by the `/settings/$section` route; emits Settings Agents, Settings Appearance, Settings Chronicle, Settings Desktop, Settings Jarvis, Settings Providers, and Settings Support render-requested performance marks when those sections are requested
- **settings-overlay-store.test.ts**: (moved to `~/store/settings-overlay.test.ts`) Store-level regression coverage for Chronicle and Agent focus target write/clear behavior
- **settings-content.tsx**: 根据当前 section 渲染对应设置页面；production 下收到 Chronicle/记录 section 会回退到 Appearance。
- **settings-content-loader.ts**: Settings content 的共享 lazy loader 与 intent preload 入口，供 app shell 和 sidebar 在打开设置前预热
- **settings-container.tsx**: Settings 布局原语。`SettingsPage` 是居中窄列页面壳（统一 22px 标题 + muted 描述），`SettingsGroup` 是 `bg-card` 分组卡片；`SettingsMasterDetail` 是供 Providers/Agents 这类编辑器过大、无法塞进窄列的 section 使用的全高双栏壳，复用 `SettingsHeader` 与 `SettingsPage` 对齐标题，并把 list/detail 包进同一张 card surface；使用它的 section 必须被 settings-content 标记为 fixed-height。
- **settings-row.tsx**: Settings 页面复用的分组标题、分隔线与行布局组件；支持在 label 旁挂载轻量 accessory，例如 dev-only badge。
- **settings-sidebar.tsx**: Settings 侧边栏导航与返回入口，使用面向用户的中文导航标签；记录/Chronicle 入口只在 dev runtime 下展示。
- **settings-sidebar.test.tsx**: Settings 侧边栏返回按钮与导航回调的可访问性回归测试
- **shortcut-settings.tsx**: Shortcuts 设置页，承载 desktop-owned AppShot bare modifier 全局触发键（Double Command / Double Option / Double Shift）和启停开关；保存后复用 desktop preferences API，并在 Electron 中通过 `native.setDesktopPreferences` 立即同步 mac bridge input configuration。页面下方使用现有 Settings row primitive 只读列举 Cradle 内置 application/contextual 快捷键，不新增 shortcut storage ownership。
- **support-settings.tsx**: Support 设置页，提供本地 diagnostics JSON 导出、feedback template copy、feedback issue 入口、Cradle-owned data directory reveal 和卸载数据保留说明；diagnostics bundle schema 跟随 Observability export contract 验证 events、incidents、errorPatterns、timeline 与 logs；Settings Support 首屏在 feedback template 与控制表面 ready 后记录 performance gate。
- **use-app-preferences.ts**: App preferences query / mutation hook，读取与写入 server-owned feature flags；`useFeatureFlag` 是前端能力入口门控的统一读取口。
- **use-chat-preferences.ts**: Chat preferences query / mutation hook，读取与写入默认 continuation behavior。
- **use-codex-preferences.ts**: Codex preferences query / mutation hook，读取与写入 Codex app-server 是否使用 Cradle User-Agent 的设置。
- **use-network-preferences.ts**: Network preferences query / mutation hook，读取与写入 Cradle server outbound proxy preferences，并在保存后刷新 proxy status 查询。
