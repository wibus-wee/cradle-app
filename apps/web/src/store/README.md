<!-- Once this directory changes, update this README.md -->

# Store

Zustand stores for renderer-side global state.
Persisted stores use versioned keys plus a safe storage wrapper, so tests / restricted environments fall back to in-memory storage instead of warning on missing `localStorage`.
Store naming convention: `use<Domain>Store`.

## Files

- **layout.ts**: Layout shell state — sidebar/right-aside/bottom-panel dimensions and visibility plus the BrowserPanel resize ratio, with idempotent setters for repeated dimension, visibility, and ratio writes; BrowserPanel dock visibility is owned by `browser-panel.ts` together with its owner-scoped pane model. Electron tear-off windows use session-scoped layout persistence, start with bottom panel and right aside collapsed, and do not persist those open/closed toggles back into the main-window layout state. Feature UI state such as Settings focus targets and Jarvis expansion lives with the owning feature
- **layout.test.ts**: Regression tests for idempotent layout store writes so repeated browser panel open/ratio updates do not broadcast unchanged state
- **browser-panel.ts**: Right Dock store and BrowserPanel runtime registry — owns dock visibility, pane order, active pane, and pane metadata per route owner/thread; centralizes singleton (`workspace-diff`, context report, launcher) versus multi-instance identity rules; persists and sanitizes restorable renderer panes per owner while keeping native browser webContents, TUI PTYs, launchers, annotations, and other runtime handles memory-only; projects native browser snapshots without overwriting renderer panes; and retains restorable dock metadata when a surface closes so reopening the same thread restores its dock.
- **browser-panel.test.ts**: Regression tests for browser panel shortcuts, per-owner BrowserPanel tab isolation, final-inner-tab close notification, browser tab source metadata, per-tab script id storage, workspace tab commands, selector-scoped render behavior for diff scroll commands, and browser annotation lifecycle cleanup/scoping.
- **right-dock.logic.ts**: Pure immutable right-dock transitions shared by the BrowserPanel store: open/focus with singleton or multi-instance policy, close-neighbor selection, active-pane validation, and empty-dock visibility rules.
- **right-dock.test.ts**: Focused coverage for singleton reuse, multi-instance identity reuse, close-neighbor selection, and empty-dock visibility.
- **layout-slots.ts**: Layout slot registry — pages inject content into aside/panel regions
- **theme.ts**: Theme preference state — light/dark/system mode
- **theme-customization.ts**: Persisted Light/Dark theme profiles and explicit user overrides; built-in profiles keep every override empty so the CSS-owned default palette remains authoritative
- **theme-customization-runtime.ts**: Projects only explicit active-profile overrides onto root CSS variables and removes them cleanly on profile/mode changes
- **sidebar-nav.ts**: Sidebar drill-in navigation state — controls which view the sidebar shows (main / settings)
- **session-activity.ts**: Renderer-visible chat session tracker only; persisted read/unread semantics are owned by the server Session module and projected through session queries
- **chat.ts**: Chat streaming state — stores per-session UI messages, browser-owned tool entities keyed by `toolCallId`, session-level run state in `runStateMap`, passive snapshot/run-status updates through a single `setPassiveRunState` reducer entry, current-run errors with stale session error cleanup, renderer-side abort-controller cleanup, active streaming diagnostics, live-steer assistant split presentation anchored by continuation queue item metadata across server canonical message id replacement and terminal run cleanup, and reconciles equivalent server snapshots without changing message references; backend `/chat/sessions/:sessionId/runtime-status` owns busy/sendability truth, server cancellation requests stay in the chat feature boundary, and Electron Desktop main owns upstream abort for brokered long-lived chat streams
- **chat.test.ts**: Regression tests for chat snapshot structural sharing, unchanged message reference preservation, and pre-SSE local driver streaming visibility
- **renderer-chat.ts**: Renderer-only live chat store for Browser Panel side conversations and provider-thread detail tabs; reuses the chat reducer factory without mixing synthetic view ids into the main session store
- **new-chat.ts**: Composer preferences — persisted last selected runtime, CLI TUI agent, agent profile, per-profile model choice, and thinking effort, plus profile reconciliation when the available profile list changes
- **new-chat.test.ts**: Regression tests for idempotent preference updates and stale-profile reconciliation
- **persist-storage.ts**: Safe persisted storage wrapper with browser `localStorage` + in-memory fallback
- **streamdown.ts**: Streamdown render settings — persisted store forced to Cradle's fixed per-character, balanced, no-cursor rendering policy
