# Quick-focus Runtime search

- **Date:** 2026-08-29
- **Problem:** Navigating a long Runtime catalog required reaching for the search field before typing.
- **Motivation:** Runtime selection is keyboard-heavy configuration work and benefits from the same quick-search convention as other Cradle lists.
- **Product behavior:** Pressing `/` outside an editable control focuses Runtime search without inserting the slash.
- **Implementation:** The list View owns an input ref and a scoped window listener that respects existing text inputs, textareas, and editable content.
- **Systems affected:** Runtime list View.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** The shortcut is contextual and therefore not added to the global shortcut catalog.
- **Follow-up ideas:** None.
- **Out of scope:** Remappable keybindings and command-palette integration.
