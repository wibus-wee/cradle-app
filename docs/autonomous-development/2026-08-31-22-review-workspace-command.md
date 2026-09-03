# Review workspace changes from the command palette

- **Date:** 2026-08-31
- **Problem:** Opening the full workspace diff required navigating through the right-aside Changes panel even when the active workspace was already known.
- **Motivation:** Reviewing the working tree is a frequent keyboard-driven developer workflow and should be directly reachable from global commands.
- **Product behavior:** The command palette now offers Review workspace changes on workspace-aware surfaces when the active workspace is available and single-folder. Selecting it closes the palette and opens the existing Cradle Diffs surface.
- **Implementation summary:** Reused palette active-workspace resolution, the workspace owner's eligibility predicate, and the existing `openWorkspaceDiffs` navigation command. No new diff or repository semantics were introduced.
- **Files / systems affected:** Web Global Search command data, search locales, feature documentation, and autonomous journal.
- **Validation performed:** Web TypeScript checking, ESLint on changed source files, locale JSON parsing, and diff validation.
- **Tradeoffs:** The command stays hidden for missing and multi-folder workspaces, where a single review root is not well-defined. It has no dedicated keybinding and remains searchable by Git/diff terms.
- **Follow-up ideas:** Add repository-specific command arguments only if the palette gains a deliberate secondary-selection workflow.
