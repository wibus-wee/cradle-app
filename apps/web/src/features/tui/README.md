<!-- Once this directory changes, update this README.md -->

# Features/Tui

Terminal UI view for cli-tui provider sessions and the bottom-panel shell.
Wraps xterm.js with FitAddon and WebglAddon; theme is derived from the app's CSS variables.
Uses HTTP only for PTY resource lifecycle (`start-or-attach`, `delete`) and a shared WebSocket live channel adapter for `snapshot` / `output` / `exit` plus `input` / `resize` / `ping`.

## Files

- **app-theme.ts**: `getAppTerminalTheme()` — reads explicit theme color overrides when present and otherwise preserves the terminal-native Light/Dark palette; its watcher also notifies terminals when the active theme profile changes.
- **terminal-font.ts**: Resolves the active theme Code font first, then falls back to the legacy PR #11 terminal preference and finally the product default stack.
- **keyboard-handler.ts**: `attachMacKeyboardHandler()` — maps macOS shortcuts (Cmd/Option+arrows, Cmd+Delete) to ANSI sequences.
- **pty-protocol.ts**: Shared PTY WebSocket message types and JSON parser for `snapshot` / `output` / `exit` / `pong` / `error`.
- **pty-protocol.test.ts**: Unit coverage for PTY WebSocket server event parsing, invalid payload rejection, and nullable exit fields.
- **pty-channel.ts**: Shared PTY WebSocket channel adapter with reconnect, ping, and queued input / resize sends.
- **bottom-terminal-panel.tsx**: Bottom-panel terminal owner UI with right-side session tabs, lazy first-session creation only while the bottom panel is open, new-session creation, runtime-only active session state, close-session anchors, automatic panel close when the final session is removed, and path/title labels from terminal metadata. It mounts only the active xterm view; inactive sessions are preserved by server PTY state, not by keeping extra xterm instances in the DOM.
- **tui-view.tsx**: TuiView component — mounts and manages an xterm.js terminal instance for a cli-tui session, including workspace file drop insertion through the shared drag payload protocol and a first-render gate after xterm mount, dimension fit, and `start-or-attach` succeed.
- **terminal-panel-cleanup.ts**: Owner-scoped cleanup boundary that removes bottom-panel session UI state and stops every backing PTY for that owner.
- **terminal-metadata.ts**: Pure helpers for parsing OSC terminal title/current-directory metadata and formatting workspace-relative path labels.
- **terminal-panel-store.ts**: Runtime-only Zustand state for bottom-panel terminal sessions scoped by chat/workspace owner; owners are created lazily when the bottom panel opens, final-session removal leaves the owner empty instead of creating a replacement, the next session id keeps advancing across reopen cycles, the session tab list is discarded when the app exits, and owner removal returns the sessions that need PTY cleanup.
- **terminal-panel-store.test.ts**: Regression coverage for owner removal returning the exact bottom-panel PTY sessions that should be stopped.
- **shell-view.tsx**: ShellView component — bottom-panel interactive shell terminal view. It owns one xterm instance at a time, mirrors PTY snapshots/output into a hidden transcript for behavior assertions, can detach without stopping the backing PTY when switching panel sessions, and reports OSC title/current-directory metadata for the panel chrome.
