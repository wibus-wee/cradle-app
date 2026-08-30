# Quick-focus Kanban search

- **Date:** 2026-08-29
- **Problem:** Kanban supports keyboard navigation for issues, but starting a search still required pointer travel.
- **Motivation:** Search is a frequent way to narrow a busy board and should fit the board's existing keyboard-first workflow.
- **Product behavior:** Pressing `/` outside an editable control focuses the issue search field. Browser and app shortcuts with modifier keys are preserved.
- **Implementation:** The toolbar View owns a ref to its existing controlled input and a scoped window keyboard listener.
- **Systems affected:** Kanban toolbar.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** The shortcut is fixed rather than configurable, matching other list search surfaces in the app.
- **Follow-up ideas:** Surface a compact shortcut hint if discoverability testing shows it is needed.
- **Out of scope:** A configurable Kanban shortcut system.
