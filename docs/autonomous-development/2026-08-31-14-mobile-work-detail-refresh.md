# Refresh mobile Work detail on demand

- **Date:** 2026-08-31
- **Problem:** Mobile Work detail polled while Work was running but offered no manual refresh after it became idle, waiting, or blocked, leaving readiness and pull-request state stale until navigation reloaded the screen.
- **Motivation:** Developers checking Work away from the desktop need an immediate, familiar way to confirm whether commits, working-tree state, or a pull request changed.
- **Product behavior:** Pulling down on Work detail now refreshes the complete detail projection and displays the native refresh indicator. Handoff text currently being edited remains intact.
- **Implementation summary:** Passed TanStack Query refetch state and action from `WorkDetailContainer` through the View contract to the shared mobile `Screen` refresh control. Added a complete owner-typed fixture for the visible Work detail View.
- **Files / systems affected:** Mobile Work detail View/container/fixture, mobile architecture documentation, and autonomous journal.
- **Validation performed:** Mobile TypeScript checking, ESLint on changed source files, and diff validation.
- **Tradeoffs:** Manual refresh complements the existing running-only polling interval instead of changing background traffic. Local handoff state intentionally does not reset from refetched server defaults.
- **Follow-up ideas:** Show an unobtrusive last-updated timestamp if users still need stronger freshness feedback.
