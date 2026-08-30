# Explain empty Runtime filters

- **Date:** 2026-08-29
- **Problem:** A zero-count Installed or Updates filter still showed built-ins, leaving the managed-runtime result ambiguous.
- **Motivation:** “Nothing needs attention” should be an explicit reassuring state, not inferred from a mixed catalog.
- **Product behavior:** Empty managed filters now state that no ACP runtimes are installed or that everything is up to date.
- **Implementation:** The Runtime list derives the message from the exact managed counts added to the filter controls.
- **Systems affected:** Runtime list View and translations.
- **Validation:** Web typecheck, targeted ESLint, and locale placeholder/key parity.
- **Tradeoffs:** Built-ins remain visible because they are always available and are not managed ACP inventory.
- **Follow-up ideas:** None.
- **Out of scope:** Update notifications and automatic installation.
