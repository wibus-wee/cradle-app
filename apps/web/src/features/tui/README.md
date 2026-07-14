<!-- Once this directory changes, update this README.md -->

# Features/Tui

Terminal UI view for cli-tui provider sessions and the bottom-panel shell.
Wraps xterm.js with FitAddon and WebglAddon; theme is derived from the app's CSS variables.
Uses HTTP only for PTY resource lifecycle (`start-or-attach`, `delete`) and a shared WebSocket live channel adapter for `snapshot` / `output` / `exit` plus `input` / `resize` / `ping`.

## Files

- **app-theme.ts**: `getAppTerminalTheme()` — resolves background, foreground, selection, cursor, and ANSI colours from the app's computed CSS theme tokens with Light/Dark fallbacks; its frame-coalesced watcher updates mounted terminals when the theme profile changes.
- **terminal-font.ts**: Resolves the active theme Code font first, then falls back to the legacy PR #11 terminal preference and finally the product default stack.
- **terminal-addons.ts**: Shared xterm addon installation for shell and CLI-TUI surfaces, including clipboard, search, progress, Unicode 11, bounded inline images, WebGL, and ligature fallback.
- **keyboard-handler.ts**: `attachMacKeyboardHandler()` — maps macOS shortcuts (Cmd/Option+arrows, Cmd+Delete) to ANSI sequences.
- **pty-protocol.ts**: Shared PTY WebSocket message types and JSON parser for `snapshot` / `output` / `exit` / `pong` / `error`.
- **pty-protocol.test.ts**: Unit coverage for PTY WebSocket server event parsing, invalid payload rejection, and nullable exit fields.
- **pty-channel.ts**: Shared PTY WebSocket channel adapter with reconnect, ping, and queued input / resize sends.
- **bottom-terminal-panel.tsx**: Owner boundary for the bottom terminal workspace. It lazily creates the first session, coordinates process cleanup, metadata, panel close behavior, and passes the retained pane tree to the view.
- **terminal-pane-layout.ts**: Pure pane-tree operations for terminal tabs, horizontal/vertical splits, activation, removal/collapse, and resize weights.
- **terminal-pane-view.tsx**: Recursive terminal workspace UI with pane-local tabs, simultaneous split panes, draggable separators, and retained xterm mounts. Hidden tabs and hidden owner panels disable input but stay mounted so scrollback, selection, search state, and renderer state survive visibility changes.
- **tui-view.tsx**: Main-surface CLI-TUI viewport. It attaches a session runtime from the registry, reports readiness, forwards workspace file drops, and projects active/hidden surface state without owning the runtime lifecycle.
- **tui-runtime-registry.ts**: Window-scoped CLI-TUI runtime registry. It keeps xterm, WebSocket, scrollback, selection, theme/font subscriptions, and process attachment alive while main Surface tabs unmount; runtimes park offscreen and reattach/refit/focus when reopened, then dispose when their Surface is explicitly closed.
- **terminal-panel-cleanup.ts**: Owner-scoped cleanup boundary that removes bottom-panel session UI state and stops every backing PTY for that owner.
- **terminal-metadata.ts**: Pure helpers for parsing OSC terminal title/current-directory metadata and formatting workspace-relative path labels.
- **terminal-panel-store.ts**: Runtime-only Zustand state for owner-scoped sessions and pane layouts. New terminals can be tabs in the focused pane or independent split panes; final-session removal leaves the owner empty, ids continue advancing across reopen cycles, and owner removal returns every PTY requiring cleanup.
- **terminal-panel-store.test.ts** / **terminal-pane-layout.test.ts**: Regression coverage for owner cleanup, tab insertion, split creation, activation, and split collapse.
- **shell-view.tsx**: ShellView component — one retained xterm runtime per session. Visibility changes disable stdin, clear focus/selection while hidden, and fit/focus on reveal without stopping the PTY; unmount cleanup remains explicit and owner-scoped.
