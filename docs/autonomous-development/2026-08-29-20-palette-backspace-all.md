# Back out of palette modes

- **Date:** 2026-08-29
- **Problem:** Clearing a mode-specific global search left the user trapped in that mode until they clicked All or cycled badges.
- **Motivation:** Backspace should continue backing out through the search state once there is no query text left.
- **Product behavior:** Backspace on an empty query returns Files, Conversations, Issues, Workspaces, or Commands mode to All.
- **Implementation:** The existing input keyboard owner handles the transition before its edge-arrow mode cycling logic.
- **Systems affected:** Global Search View and feature documentation.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** The first empty Backspace changes mode instead of dismissing the palette; Escape remains the dismissal action.
- **Follow-up ideas:** None.
- **Out of scope:** Search navigation history.
