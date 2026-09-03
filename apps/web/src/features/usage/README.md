<!-- Once this directory changes, update this README.md -->

# Features/Usage

Token usage and cost analytics dashboard.
Displays a GitHub-style contribution heatmap of daily token consumption with aggregate stats.
Data sourced from the `usage_logs` SQLite table via the Usage API.
当前 UI 公开最小稳定锚点供真实入口 E2E 使用：dashboard 根节点、空状态、关键 summary pills、总 token 数，以及 heatmap cell / tooltip。
Dashboard headings, stat labels, chart labels, and empty states are owned by the `usage` i18n namespace.

## Files

- **usage-dashboard.tsx**: Query/theme container that translates Usage API state into the dashboard View contract.
- **usage-preferences-store.ts**: Safely persisted dashboard preferences, currently the selected time range, with validation for stale storage.
- **usage-export.ts**: Selected-range daily CSV projection and browser download handoff, including per-model cost aggregation.
- **usage-export.test.ts**: Verifies range filtering and per-day cost aggregation in exported data.
- **usage-dashboard-view.tsx**: Fixture-driven dashboard surface with loading, empty, populated, range-selection, heatmap, stats, and ranking states. Token/USD display is owned by renderer `~/lib/number-format`.
- **usage-dashboard-view.stories.tsx**: Populated, empty, loading, and dark Storybook scenes backed by Usage-owned response fixtures.
- **usage-hero-cards.tsx**: Range-aware headline KPIs (cost/tokens/turns) with vs-previous-period deltas; streak remains all-history.
- **usage-heatmap.tsx**: SVG-based rounded-cell heatmap calendar (53 weeks × 7 days)；cell 暴露日期与是否有 usage 的稳定属性，tooltip 可用于回归验证
- **usage-trend-chart-view.tsx**: Props-only ECharts stacked token/cost trend by model. Theme mode is explicit so the chart does not subscribe to global theme state.
- **usage-cache-breakdown-view.tsx**: Props-only cache-aware token/cost summary and daily composition chart for uncached input, cache reads, cache writes, and output.
- **usage-runtime-performance-view.tsx**: Props-only cross-runtime P50/P95 first-token and total-duration panel with retained-data coverage, daily runtime trends, and runtime comparison.
- **usage-insights.ts**: Dense series helpers, period comparisons, model stacks, and cache-aware token/cost composition. Fleet helpers pivot per-device daily rows into device / device × model stacks.
- **usage-fleet.ts**: Fleet usage model (this device + reachable Fabric nodes, each carrying the full usage surface: daily/by-model/cost/hourly/efficiency series plus range-scoped summary/tools/performance). Merging across devices is a renderer concern — the server never aggregates cross-device.
- **usage-fleet-merge.ts**: Pure fleet-wide merge. Additive measures (tokens, cost, call counts) are summed; medians/percentiles combine as sample-count-weighted averages (approximation — the API doesn't expose raw samples). Stats (streaks/active days/peak) are recomputed from the merged daily series.
- **use-fleet-usage.ts**: Loads each remote online node's full Usage API via the Fabric upstream proxy (`fetchNodeUpstreamJson`) and merges with local series. The Fabric directory's local node is excluded because its usage is already supplied locally. Returns `null` when no remote nodes exist so the dashboard keeps its single-device surface. Offline nodes and failed reads surface as `unavailable` devices; loading nodes simply join `merged` progressively.
- **usage-device-breakdown.tsx**: Props-only per-device tokens/cost share rows with turns and active days, plus a muted list of unavailable Fabric nodes.
- **use-usage-overview.ts**: Shared renderer hook for Usage dashboard/profile surfaces; wraps generated Usage query options and exports generated-derived response aliases without adding local validation projections. Performance remains an enhancement query and does not block the core dashboard readiness state.
- **usage-time-range.ts**: Supported dashboard ranges, day resolution, and the persistence-boundary range validator.
