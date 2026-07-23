# Kanban

Kanban renders board/list/detail views over Issue-owned workspace data. Issue metadata, comments, relations, statuses, milestones, and delegation controls call the Issue and Issue Agent capabilities rather than making Kanban the data owner.
User-facing board, issue, filter, status, and label-management copy is owned by the `kanban` i18n namespace; issue/workspace data values remain Issue-owned data.

## Files

- **create-issue-dialog.tsx**: Floating create-issue panel with status, priority, assignee, and label metadata controls.
- **index.tsx**: Kanban feature entrypoint and page composition; board view owns status move wiring, accepts tab-provided milestone focus filters, and keeps board/list/table read/select/create flows focused.
- **issue-aside-panel.tsx**: Right-aside linked issue panel for chat sessions, including linked issue summary, unlink/open actions, and a searchable combobox picker with status icons and issue badges; records the right-aside Issue first-render mark after linked issue state, workspace list, statuses, board list, comments, and picker issues are ready.
- **issue-aside-panel-loader.ts**: Issue aside panel 的共享 lazy loader 与 intent preload 入口，供 right aside Issue tab 使用
- **issue-aside-panel.test.tsx**: Regression tests for linked issue rendering, Kanban navigation, unlink actions, and combobox-based issue linking.
- **issue-context-menu.tsx**: Shared right-click issue actions for board cards and list rows.
- **issue-detail/**: Issue detail 子视图，包含属性、活动、关系、子 issue、milestone 横幅、workspace label 管理，以及独立于 human assignee 的 agent delegation 控制；activity/comment/header/properties 面板通过 memoized row/pane 与稳定 action handler 控制渲染预算。
- **kanban-board.tsx**: Board layout and drag/drop composition; forwards resolved parent issue refs to cards and drag overlays.
- **kanban-card.tsx**: Drag/context/query adapter for individual issue cards; it resolves workspace/agent runtime data and preserves native issue-open controls.
- **kanban-card-view.tsx**: Fixture-driven issue card rendering contract with explicit issue, status, workspace, agent, selection, and callback props.
- **kanban-surfaces.stories.tsx**: Storybook catalog for card states, group headers, status/priority icons, labels, assignees, and parent issue links.
- **kanban-column.tsx**: Board column rendering and drop targets; inline create mounts without height animation so board layout work stays immediate, and issue maps forward stable open/hover handlers plus parent issue refs.
- **kanban-context.ts**: Kanban-owned renderer context provider factory for selected, open, peeked, focused, hovered, filtered, and visible issue attention state; app composition owns provider installation.
- **kanban-context.test.ts**: Unit coverage for Kanban attention context publication and stable issue references.
- **kanban-group-header.tsx**: Group header rendering for board/list views with named create controls and expanded state.
- **kanban-group-header.test.tsx**: Regression tests for group header expanded state, decorative icons, keyboard-visible create control, and callbacks.
- **kanban-list.tsx**: List-view composition for issues; group collapse uses instant layout changes instead of height/auto motion animation.
- **kanban-item-actions.test.tsx**: Regression tests for native issue card/list row button semantics.
- **kanban-list-row.tsx**: Compact list row for individual issues; rows use native named buttons for opening detail views, indent child issues, and expose separate parent issue quick-jump affordances.
- **kanban-parent-issue-link.test.tsx**: Regression tests for parent issue indicators on Kanban cards and list rows.
- **kanban-selection.ts**: Pure helper functions for visible-order multi-selection, toggle, and range semantics.
- **kanban-selection.test.ts**: Regression tests for Linear-style issue selection ranges and toggles.
- **kanban-selection-bar.tsx**: Floating bulk action bar for selected issues, currently supporting status and priority updates.
- **kanban-sidebar-loader.ts**: Kanban sidebar 的共享 lazy loader 与 intent preload 入口，避免 workspace shell eager import Kanban 实现，并记录 sidebar lazy surface first-render start mark
- **kanban-sidebar.tsx**: Workspace/status navigation for the Kanban feature, using app-level current-tab navigation for board entries; records the Kanban sidebar first-render gate after the boards query succeeds, and exposes stable create-board dialog anchors for e2e flows.
- **kanban-toolbar.tsx**: View, filtering, status-management, and issue-creation controls with named icon-only toolbar actions.
- **kanban-toolbar.test.tsx**: Regression tests for toolbar action accessible names, decorative icons, pressed layout state, and key callbacks.
- **shared/**: Kanban 内部复用的视觉与元数据 helper，包括 priority label、彩色 label metadata、父 issue affordance、图标和头像。
- **status-manager.tsx**: Status management UI with accessible inline rename, delete, and reorder controls.
- **use-kanban.ts**: Kanban board 与 Issue-owned status、milestone、relation、comment、Activity projection、raw field-change history、bulk update、label patching、delegation 操作的 TanStack Query hooks；高影响 workspace 读取使用共享 query refresh policy，使外部 CLI、agent 和多窗口变更无需整页刷新即可可见。
- **use-view-config.ts**: Local view configuration state for board/list/table display options.
