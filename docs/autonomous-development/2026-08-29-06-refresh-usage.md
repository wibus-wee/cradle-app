# Refresh local and fleet Usage

- **Date:** 2026-08-29
- **Problem:** A Usage dashboard left open during active work had no explicit way to request current telemetry.
- **Motivation:** Cost and performance review often happens alongside running agents, where stale numbers are misleading.
- **Product behavior:** A refresh action re-fetches every local Usage endpoint and invalidates every remote Fabric Usage query, with a disabled spinning state until completion.
- **Implementation:** The Usage hook exposes one explicit refetch operation; the container also invalidates the structurally identified `node-upstream` / `usage-fleet` queries.
- **Systems affected:** Usage data hook, dashboard container/View, fixtures, and translations.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** Refresh is user-initiated to avoid background request load across multiple Fabric nodes.
- **Follow-up ideas:** Consider low-frequency refresh only if dogfooding shows persistent stale dashboards.
- **Out of scope:** Polling, push updates, and changing React Query stale times.
