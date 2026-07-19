<!-- Once this directory changes, update this README.md -->

# Renderer/Hooks

Cross-feature renderer hooks live here.
Use this directory for app-shell side effects and environment queries that are reused outside a single feature.
Keep feature-owned hooks inside their feature folders unless multiple domains truly depend on them.

## Files

- **use-global-event-listeners.ts**: App-shell side-effect hook wiring PTY pushes, keyboard shortcuts, visible-chat ownership, and chat run-settled unread reconciliation; BrowserPanel webview tab shortcuts resolve against the active route surface's BrowserPanel owner id; chrome layout chords (`Ctrl+\``, `⌘⌥B`, surface close/cycle, new chat, external terminal) set `allowInEditable` so they still fire from Composer contenteditable and bottom-panel xterm textareas; macOS-sensitive chords match on both `key` and `code` where needed (including `Backquote` for `` ` ``), and workspace terminal launch only intercepts when an active workspace path is available.
- **use-media-query.ts**: Media-query subscription helper for responsive UI behavior
- **use-mobile.ts**: Mobile breakpoint helper derived from shared media-query logic
- **use-now.ts**: Shared clock hook with optional active-state gating so hidden or backgrounded feature views can avoid interval work.
- **use-shortcut.ts**: Keyboard shortcut registration helper for renderer components
