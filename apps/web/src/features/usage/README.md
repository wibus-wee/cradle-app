<!-- Once this directory changes, update this README.md -->

# Features/Usage

Token usage and cost analytics dashboard.
Displays a GitHub-style contribution heatmap of daily token consumption with aggregate stats.
Data sourced from the `usage_logs` SQLite table via the Usage API.
当前 UI 公开最小稳定锚点供真实入口 E2E 使用：dashboard 根节点、空状态、关键 summary pills、总 token 数，以及 heatmap cell / tooltip。
Dashboard headings, stat labels, chart labels, and empty states are owned by the `usage` i18n namespace.

## Files

- **usage-dashboard.tsx**: Query/theme container that translates Usage API state into the dashboard View contract.
- **usage-dashboard-view.tsx**: Fixture-driven dashboard surface with loading, empty, populated, range-selection, heatmap, stats, and ranking states. Token/USD display is owned by renderer `~/lib/number-format`.
- **usage-dashboard-view.stories.tsx**: Populated, empty, loading, and dark Storybook scenes backed by Usage-owned response fixtures.
- **usage-hero-cards.tsx**: Range-aware headline KPIs (cost/tokens/turns) with vs-previous-period deltas; streak remains all-history.
- **usage-heatmap.tsx**: SVG-based rounded-cell heatmap calendar (53 weeks × 7 days)；cell 暴露日期与是否有 usage 的稳定属性，tooltip 可用于回归验证
- **usage-trend-chart-view.tsx**: Props-only ECharts stacked token/cost trend by model. Theme mode is explicit so the chart does not subscribe to global theme state.
- **usage-insights.ts**: Dense series helpers, period comparisons, and model stacks for tokens + cost.
- **use-usage-overview.ts**: Shared renderer hook for Usage dashboard/profile surfaces; wraps generated Usage query options and exports generated-derived response aliases without adding local validation projections.
