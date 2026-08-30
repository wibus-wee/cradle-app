# Clear review file filters

- **Date:** 2026-08-29
- **Problem:** A Diff Review file filter could be cleared only by editing the query character by character.
- **Motivation:** Reviewers frequently alternate between a narrow path search and the complete changed-file index.
- **Product behavior:** A clear action appears beside any active file query. Escape clears the query from the focused input as a keyboard equivalent.
- **Implementation:** The self-contained Review file rail resets its local query without disturbing the selected file or viewed state.
- **Systems affected:** Diff Review file rail.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** Labels remain in the Review surface's existing English-only vocabulary.
- **Follow-up ideas:** Localize the Review surface as a dedicated effort.
- **Out of scope:** File-content search and Review filter persistence.
