# Global Search

Global Search provides the app-wide command palette for commands, workspace
files, conversations, issues, and workspaces.

## Rendering seam

- `global-search-dialog.tsx` owns the public open/closed boundary and landing
  prefetch.
- `global-search-dialog-content.tsx` owns palette data hooks, browser-panel
  actions, command history, and application navigation.
- Issue results reuse the Kanban owner's search hook and query-key root, so
  Issue creation, edits, bulk updates, and deletion invalidate both board and
  global-search projections together. A result becomes visible only after its
  target board resolves, making every visible Issue row navigable.
- App commands include one-shot recovery for the most recently user-closed
  surface. The command is omitted when navigation has no recovery target.
- Primary creation commands open New Chat and New Work through their existing
  navigation owners. When the active surface resolves to a workspace, both
  commands carry that context forward and show its name in the palette row.
- Workspace-aware surfaces expose a Copy workspace path command. It uses the
  workspace owner's canonical local or remote location label and reports
  clipboard success or failure through app toasts.
- Eligible active workspaces expose a Review workspace changes command that
  opens the existing Cradle Diffs surface without routing through the aside.
- `global-search-dialog-view.tsx` receives the current mode, query,
  owner-typed `PaletteData`, and callbacks. It owns only dialog focus, keyboard
  cycling, empty-query Backspace recovery to All, and presentation.
- Each palette result semantic component lives in its own file under
  `palette/`.
- `fixtures/global-search.ts` and
  `global-search-dialog-view.stories.tsx` render all visible search modes and
  loading/empty states without queries, stores, routes, or navigation.
