# Start New Work from the command palette

- **Date:** 2026-08-31
- **Problem:** The command palette exposed New Chat but not New Work, forcing users to leave the keyboard workflow and locate Work creation in the sidebar.
- **Motivation:** Work is a primary Cradle workflow and should be as discoverable as conversation creation in the app-wide command surface.
- **Product behavior:** Searching commands for “work,” “task,” “branch,” or localized equivalents now offers **New Work** and opens the existing creation surface.
- **Implementation:** The palette contributes a localized app command that delegates to the existing `openNewWork` navigation owner. The New Work surface continues to own workspace, issue, and base-branch selection.
- **Systems affected:** Global search command data, search translations, and search ownership documentation.
- **Validation:** Web typecheck, targeted ESLint, locale JSON parsing, and diff whitespace checks.
- **Tradeoffs:** The command has no dedicated keybinding; the palette is its fast keyboard entry point.
- **Follow-up ideas:** Evaluate whether Automation creation deserves the same command once its large dashboard has a fixture-driven creation View.
- **Out of scope:** Work creation behavior, default workspace selection, issue linking, and new shortcut registration.
