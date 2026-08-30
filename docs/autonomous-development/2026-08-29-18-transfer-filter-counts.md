# Show transfer filter counts

- **Date:** 2026-08-29
- **Problem:** Download Activity filters provided no preview of where active, failed, or completed transfers were located.
- **Motivation:** Transfer state is operational information; counts let users navigate directly to the relevant slice.
- **Product behavior:** Every channel and status filter shows a count constrained by the currently selected filter in the other dimension.
- **Implementation:** One exact status predicate is shared by list filtering and cross-filter counts, including the derived active state.
- **Systems affected:** Managed Resource Activity View.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** Counts recompute over the in-memory transfer list, which is small and already fully loaded.
- **Follow-up ideas:** None.
- **Out of scope:** Server-side aggregation.
