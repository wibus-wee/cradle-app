<!-- Once this directory changes, update this README.md -->

# Features/Kanban/Shared

Kanban 视图内部复用的轻量展示组件与元数据 helper。

## Files

- **assignee-avatar.tsx**: 受理人头像展示组件；根元素使用 phrasing-safe `span`，可安全放入 issue card / row 的原生按钮内部。
- **format-issue-id.ts**: 根据 workspace identifier 和 issue number 生成用户可读 issue key。
- **issue-delegation.ts**: 从 Issue-owned delegation 字段解析当前委派 Agent，避免空 provider target 被误判为委派。
- **issue-metadata.ts**: 标签解析与 priority display option helper。
- **label-chip.tsx**: 带确定性色板的紧凑标签 chip。
- **label-metadata.ts**: 从 Issue-owned labels 派生 workspace label 列表、确定性色调，以及 rename/delete 批量 patch helper。
- **label-metadata.test.ts**: 覆盖 label 收集、筛选、rename 合并和 delete patch helper 的回归测试。
- **priority-icon.tsx**: Priority 可视化 SVG。
- **status-icon.tsx**: Status category 可视化 SVG。
