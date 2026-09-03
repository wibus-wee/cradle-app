# Show filtered pull request counts

- **Date:** 2026-08-29
- **Problem:** The pull request header always showed the loaded total, even when the visible list was filtered.
- **Motivation:** Users need immediate confirmation that a filter changed the working set.
- **Product behavior:** The count switches to “visible of total” whenever search, ownership, state, or repository filtering is active.
- **Implementation:** The page view derives one active-filter flag from its existing local state and reuses the memoized visible list.
- **Systems affected:** Pull request list header and translations.
- **Validation:** Web typecheck, ESLint pre-commit hook, and placeholder parity across supported locales.
- **Tradeoffs:** Counts reflect loaded pages, matching the list rather than claiming a server-wide total.
- **Follow-up ideas:** Surface server totals if the feed API gains exact count metadata.
- **Out of scope:** Pagination and server-side filtering.
