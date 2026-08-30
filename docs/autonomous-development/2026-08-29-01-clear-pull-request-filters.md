# Recover from empty pull request filters

- **Date:** 2026-08-29
- **Problem:** A search or filter combination could empty the pull request list without offering a direct way back.
- **Motivation:** Filtering is useful only when users can recover quickly from an over-constrained view.
- **Product behavior:** The filtered empty state now offers a single action that clears the search, ownership, state, and repository filters.
- **Implementation:** The fixture-driven page view owns the reset because it already owns all four pieces of local filter state.
- **Systems affected:** Pull request list view and pull request translations.
- **Validation:** Web typecheck and i18n consistency checks.
- **Tradeoffs:** Filter state remains local to the mounted page.
- **Follow-up ideas:** Persist useful filters if repeated dogfooding shows that users regularly restore the same view.
- **Out of scope:** URL state, server-side filtering, and changes to pagination.
