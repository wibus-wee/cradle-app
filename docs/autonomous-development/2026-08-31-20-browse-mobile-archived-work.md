# Browse archived Work on Mobile

- **Date:** 2026-08-31
- **Problem:** Archived Work disappeared from Mobile even though users may need to revisit its conversation, outcome, or handoff details.
- **Motivation:** Work history is part of the product record and should remain useful away from the desktop.
- **Product behavior:** The Work screen now switches between Active and Archived lists. Archived Work can be searched, refreshed, opened, and inspected; creation controls and active-only activity filters stay hidden in archive mode.
- **Implementation:** The Mobile container loads both explicit server lifecycle filters and passes them into the fixture-renderable view. The view owns only lifecycle and activity presentation state.
- **Systems affected:** Mobile Work list container, view, and fixture contract.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Both lifecycle pages are loaded together to make switching immediate; each remains capped at the server's existing 200-item Mobile limit.
- **Follow-up ideas:** Add a permission-aware restore action with clear mutation feedback.
- **Out of scope:** Restoring, deleting, or changing archived Work.
