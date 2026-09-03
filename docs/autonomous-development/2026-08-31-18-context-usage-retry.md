# Retry context usage in place

- **Date:** 2026-08-31
- **Problem:** Context usage queries intentionally disabled automatic retries, but failures in the composer detail popover and compact context viewer had no recovery action.
- **Motivation:** Provider runtime usage can be temporarily unavailable during startup or reconnection; users should recover without closing the surface or reloading the session.
- **Product behavior:** Both context usage headers now show a Retry icon only in the error state. It disables and spins while the replacement request is active, then returns to the usual percentage display after recovery.
- **Implementation summary:** Passed TanStack Query refetch and fetching state through both existing fixture-driven View contracts. Containers retain query ownership, while Views own the compact header action.
- **Files / systems affected:** Web Chat context usage containers/Views/story, Chat feature documentation, and autonomous journal.
- **Validation performed:** Web TypeScript checking, ESLint on changed source files, and diff validation.
- **Tradeoffs:** The action is icon-only to preserve compact panel dimensions and uses the surface's existing English copy. The full Browser Panel report remains unchanged.
- **Follow-up ideas:** Localize the complete Context Usage surface as one coherent pass rather than translating this action in isolation.
