# Understand Usage with a native iOS dashboard

- **Date:** 2026-08-31
- **Problem:** Usage already used a segmented control, but its totals, daily chart, statistics, expandable model breakdown, provider attribution, refresh, and empty state were all custom React Native layouts on iOS.
- **Motivation:** Usage is dense numeric information that benefits from iOS-native hierarchy and accessibility. Swift Charts, grouped sections, labeled rows, tabular digits, and progress indicators make the same data easier to scan without inventing new metrics.
- **Product behavior:** iOS now switches ranges with a native segmented Picker, summarizes tokens and turns in an inset-grouped Form, charts the last 14 days with Swift Charts, displays activity statistics in LabeledContent rows, and compares models and providers with native ProgressViews. Model expansion, system empty state, and pull-to-refresh remain available. Numeric labels use monospaced digits and the chart intentionally does not animate. Android and Web keep the existing dashboard.
- **Implementation:** `UsageView.ios.tsx` is a platform-specific fixture-driven View. The View props moved to a shared contract, while number formatting and dense 14-day normalization moved to a shared display model used by both platform Views. Refresh callbacks can return the query promise so the native indicator follows the actual refetch; range persistence and all three usage queries remain Container-owned.
- **Systems affected:** Mobile Usage platform Views, shared Usage View contract/model, Usage Container refresh callback, and fixtures.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web.
- **Tradeoffs:** The native chart keeps the existing fixed 14-day context even when a broader range is selected, preserving the established product meaning. Cost estimation and budget interpretation remain absent because the server does not own reliable pricing data here.
- **Follow-up ideas:** Dogfood model and provider labels at accessibility text sizes and consider a native detail drill-down only if users need per-day attribution.
- **Out of scope:** Cost estimates, budgets, alerts, CSV export, new aggregation APIs, provider pricing, and Android dashboard migration.
