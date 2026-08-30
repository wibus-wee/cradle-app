# Copy the active workspace path from the command palette

- **Date:** 2026-08-31
- **Problem:** Copying the current workspace path required finding its sidebar row and opening a context menu, even when the active chat or workspace surface already established the relevant context.
- **Motivation:** Paths are frequently pasted into terminals, issue descriptions, prompts, and external tools; making this a keyboard-driven command removes repeated navigation.
- **Product behavior:** The command palette now offers Copy workspace path on workspace-aware New Chat, chat, and workspace surfaces. It displays the resolved path as command detail, closes after selection, and reports clipboard success or failure.
- **Implementation summary:** Reused the palette's active-workspace resolution and the workspace owner's canonical location formatter. A workspace query supplies command context, while the existing command owner handles execution and feedback.
- **Files / systems affected:** Web Global Search palette, search locales, feature documentation, and autonomous journal.
- **Validation performed:** Web TypeScript checking, ESLint on changed source files, locale JSON parsing, and diff validation.
- **Tradeoffs:** The command is hidden until workspace metadata resolves and is limited to surfaces with an unambiguous active workspace. Remote locations copy as `node:path` rather than an ambiguous remote filesystem path.
- **Follow-up ideas:** Add open-in-terminal or reveal commands only when native and remote-node ownership can provide consistent semantics.
