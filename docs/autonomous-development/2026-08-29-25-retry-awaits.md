# Retry unavailable Awaits

- **Date:** 2026-08-29
- **Problem:** A failed Awaits load displayed an error but gave the user no direct recovery action.
- **Motivation:** People checking blocked sessions should not need to wait for polling or leave the page after a transient desktop error.
- **Product behavior:** The localized error state now includes a Retry button that disables and spins while a reload is in flight.
- **Implementation:** The query-owning container exposes its existing `refetch` and fetching state to the props-only overview View.
- **Systems affected:** Awaits overview, story fixtures, tests, and translations.
- **Validation:** Targeted Vitest coverage, web typecheck, targeted ESLint, locale JSON parsing, and pre-commit validation.
- **Tradeoffs:** Retry reloads the complete small await collection rather than attempting partial recovery.
- **Follow-up ideas:** Preserve last-known await rows if the desktop bridge can distinguish stale data from total failure.
- **Out of scope:** Polling cadence and offline persistence.
