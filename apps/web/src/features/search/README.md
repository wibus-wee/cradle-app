# Global Search

Global Search provides the app-wide command palette for commands, workspace
files, conversations, issues, and workspaces.

## Rendering seam

- `global-search-dialog.tsx` owns the public open/closed boundary and landing
  prefetch.
- `global-search-dialog-content.tsx` owns palette data hooks, browser-panel
  actions, command history, and application navigation.
- App commands include one-shot recovery for the most recently user-closed
  surface. The command is omitted when navigation has no recovery target.
- `global-search-dialog-view.tsx` receives the current mode, query,
  owner-typed `PaletteData`, and callbacks. It owns only dialog focus, keyboard
  cycling, empty-query Backspace recovery to All, and presentation.
- Each palette result semantic component lives in its own file under
  `palette/`.
- `fixtures/global-search.ts` and
  `global-search-dialog-view.stories.tsx` render all visible search modes and
  loading/empty states without queries, stores, routes, or navigation.
