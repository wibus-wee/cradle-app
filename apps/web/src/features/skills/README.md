<!-- Once this directory changes, update this README.md -->

# Features/Skills

Skills 功能模块提供统一的 filesystem-first 管理界面，覆盖 workspace 与 agent 两类可写层；workspace 页面会把 `<workspace>/.agents/skills` 的只读 repository scope 折叠显示为 Workspace，但写入仍只进入 `<workspace>/.cradle/skills`。
这个模块只消费 `skills` IPC service，不自行维护第二套 skill 开关状态。
当任一页面需要查看、编辑、导入导出 Skills 时，都应复用这里的 hook 与 manager；Workspace Skills 首屏以 inventory query success 作为 readiness performance gate。
导出 Skills 会写入用户选择的外部目录，`use-skills.ts` 必须向 `/skills/export` 传递 `confirmedNonCradleOwnedWrite: true`，并解析服务端返回的 `ownerBoundary`。
Skills import flow copy is owned by the `skills` i18n namespace; discovered skill names/descriptions remain source-owned data.

## Files

- **index.ts**: Skills 功能模块的 barrel export
- **skill-import-dialog.tsx / skill-import-dialog-view.tsx**: source-import mutation/reducer 容器与 fixture-driven 多步骤 View，支持 GitHub/GitLab/git URL 与本地路径；移动端使用单栏主流程，桌面端保留信息侧栏。
- **skill-import-*-view.tsx**: 输入、加载、选择、完成和信息侧栏的独立展示组件；loading indicator 使用 transform 动画而不是 left/width 布局动画，所有流程文案通过 `skills` namespace 读取。
- **skill-manager.tsx**: 通用 Skills 容器，负责 inventory query、层级过滤、目录选择、mutation 与对话框编排；Workspace Skills 首屏在 inventory query 成功后记录 performance gate。
- **skill-manager-view.tsx**: fixture-driven 主列表 View，接收 owner 类型的 inventory 与 callbacks，不读取 query、route、store 或 Electron。
- **skill-detail-container.tsx / skill-detail-view.tsx**: 详情 document query 与纯展示边界。
- **skill-edit-dialog-container.tsx / skill-edit-dialog-view.tsx**: document/mutation adapter 与本地表单 View 边界。
- **skill-scope-presentation.ts**: 集中维护 scope label、icon 与静态 Tailwind class 映射。
- **use-skills.ts**: TanStack Query hooks，负责 inventory、document、mutation、source-import 以及 export owner-boundary contract 的 IPC 调用，并暴露 inventory query success 作为 workspace skills readiness 口径
