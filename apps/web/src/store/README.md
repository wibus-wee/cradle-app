<!-- Once this directory changes, update this README.md -->

# Store

Zustand stores for renderer-side global state.
Persisted stores use versioned keys plus a safe storage wrapper, so tests / restricted environments fall back to in-memory storage instead of warning on missing `localStorage`.
Store naming convention: `use<Domain>Store`.

## Files

- **layout.ts**: Layout shell state — sidebar/aside/panel dimensions and visibility only, with idempotent setters for repeated dimension, visibility, and ratio writes; exposes explicit target-state setters for sidebar and right aside so layout-owned shortcuts can converge partial states without relying on toggles; bottom panel visibility defaults open in main windows; BrowserPanel open/closed state is keyed by the owning route surface id while the resize ratio stays shell-level; Electron tear-off windows use session-scoped layout persistence, start with bottom panel and right aside collapsed, and do not persist those open/closed toggles back into the main-window layout state. Feature UI state such as Settings focus targets and Jarvis expansion now lives with the owning feature
- **layout.test.ts**: Regression tests for idempotent layout store writes so repeated browser panel open/ratio updates do not broadcast unchanged state
- **browser-panel.ts**: Right-side BrowserPanel tab state — owns owner-scoped native browser metadata snapshots, chooser launcher tabs, TUI shell tab metadata, workspace-file/workspace-diff panel tabs, live side-conversation panel tabs, mixed active panel tab selection, recent browser history persisted in localStorage, browser-use tab requests, browser tab source session metadata, per-tab script metadata retained for compatibility, scoped diff scroll commands, browser annotation records/tray state, and close-result reporting so the app shell can collapse the BrowserPanel after its final inner tab closes. Browser annotations, TUI shell tabs, and side conversation tabs are renderer-memory state; persistence is limited to lightweight tray UI preferences.
- **browser-panel.test.ts**: Regression tests for browser panel shortcuts, per-owner BrowserPanel tab isolation, final-inner-tab close notification, browser tab source metadata, per-tab script id storage, workspace tab commands, selector-scoped render behavior for diff scroll commands, and browser annotation lifecycle cleanup/scoping.
- **layout-slots.ts**: Layout slot registry — pages inject content into aside/panel regions
- **theme.ts**: Theme preference state — light/dark/system mode
- **sidebar-nav.ts**: Sidebar drill-in navigation state — controls which view the sidebar shows (main / settings)
- **session-activity.ts**: Renderer-visible chat session tracker only; persisted read/unread semantics are owned by the server Session module and projected through session queries
- **chat.ts**: Chat streaming state — stores per-session UI messages, browser-owned tool entities keyed by `toolCallId`, session-level run state in `runStateMap`, passive snapshot/run-status updates through a single `setPassiveRunState` reducer entry, current-run errors with stale session error cleanup, renderer-side abort-controller cleanup, active streaming diagnostics, live-steer assistant split presentation anchored by continuation queue item metadata across server canonical message id replacement and terminal run cleanup, and reconciles equivalent server snapshots without changing message references; backend `/chat/sessions/:sessionId/runtime-status` owns busy/sendability truth, server cancellation requests stay in the chat feature boundary, and Electron Desktop main owns upstream abort for brokered long-lived chat streams
- **chat.test.ts**: Regression tests for chat snapshot structural sharing, unchanged message reference preservation, and pre-SSE local driver streaming visibility
- **renderer-chat.ts**: Renderer-only live chat store for Browser Panel side conversations and provider-thread detail tabs; reuses the chat reducer factory without mixing synthetic view ids into the main session store
- **new-chat.ts**: Composer preferences — persisted last selected runtime, CLI TUI agent, agent profile, per-profile model choice, and thinking effort, plus profile reconciliation when the available profile list changes
- **new-chat.test.ts**: Regression tests for idempotent preference updates and stale-profile reconciliation
- **persist-storage.ts**: Safe persisted storage wrapper with browser `localStorage` + in-memory fallback
- **streamdown.ts**: Streamdown render settings — persisted store forced to Cradle's fixed per-character, balanced, no-cursor rendering policy
