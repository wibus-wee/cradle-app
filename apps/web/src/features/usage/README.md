<!-- Once this directory changes, update this README.md -->

# Features/Usage

Token usage and cost analytics dashboard.
Displays a GitHub-style contribution heatmap of daily token consumption with aggregate stats.
Data sourced from the `usage_logs` SQLite table via the Usage API.
当前 UI 公开最小稳定锚点供真实入口 E2E 使用：dashboard 根节点、空状态、关键 summary pills、总 token 数，以及 heatmap cell / tooltip。
Dashboard headings, stat labels, chart labels, and empty states are owned by the `usage` i18n namespace.

## Files

- **usage-dashboard.tsx**: Main dashboard page component with heatmap + stats + top usage rankings；现展示 Prompt / Completion / Turns 与关键排行汇总，token/USD display 由 renderer-owned `~/lib/number-format` 负责，便于核对 `usage_logs` 聚合
- **usage-heatmap.tsx**: SVG-based rounded-cell heatmap calendar (53 weeks × 7 days)；cell 暴露日期与是否有 usage 的稳定属性，tooltip 可用于回归验证
- **usage-trend-chart.tsx**: ECharts token/cost trend with model filtering, wheel zoom, drag panning, a range slider, animated zoom controls, and visible-range feedback
- **use-usage-overview.ts**: Shared renderer hook for Usage dashboard/profile surfaces; wraps generated Usage query options and exports generated-derived response aliases without adding local validation projections.
