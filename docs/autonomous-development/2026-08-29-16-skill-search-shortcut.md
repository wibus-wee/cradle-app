# Quick-focus Skill search

- **Date:** 2026-08-29
- **Problem:** Opening a large Skill inventory still required pointer navigation before searching.
- **Motivation:** Keyboard users should be able to move directly from browsing to filtering.
- **Product behavior:** Pressing `/` outside editable content focuses the Skill search field.
- **Implementation:** The fixture-driven Manager View owns the input ref and cleans up a guarded contextual key listener on unmount.
- **Systems affected:** Skill Manager View.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** The contextual binding is not added to global shortcuts.
- **Follow-up ideas:** None.
- **Out of scope:** User-remappable bindings.
