<!-- Once this directory changes, update this README.md -->

# Features/Devtool

Developer tooling feature with runtime diagnostics for observability, health, memory, route surface state, and plugin runtime state.
Rendered at the `/devtool` route in a separate Electron window or at `#/devtool` in the web app.
The root page owns the devtool tab model and window-level `Cmd/Ctrl + 1..5` tab switching listener.
User-facing diagnostic labels and status text are owned by the `devtool` i18n namespace.

## Directories

- **ipc/**: IPC trace inspection — real-time view of all typed IPC calls between renderer and main process
- **acp/**: ACP event inspection — real-time view of ACP agent protocol events
- **agent-context/**: Agent context snapshots captured before provider stream execution
- **observability/**: Canonical observability event/incident inspection and local export controls
- **plugins/**: Plugin discovery, layer state, declared/runtime contribution graph, client panel registration, and command execution diagnostics
- **resources/**: AppHeader resources popover with renderer, server, CLI TUI, bottom-panel process memory breakdown, and partial endpoint failure feedback
- **background-activity/**: Dev footer popover for the server-owned registry of runtime maintenance and other background activity
- **surfaces/**: Router and app surface diagnostics for active route, opened surfaces, ordering, and owner identity

## Files

- **ipc-devtool-page.tsx**: DevtoolPage — root component for the devtool window; composes all devtool panels and installs `Cmd/Ctrl + 1..5` tab shortcuts
- **ipc-devtool-page.test.tsx**: Regression tests for devtool tab shortcut routing
- **flow-color.ts**: Shared color helpers for flow direction rendering (shared by ipc/ and acp/)
- **health/health-panel.tsx**: Server health panel with localized loading/error labels and health metric rows.
- **memory/memory-panel.tsx**: Renderer memory and Web Vitals panel with localized headings and empty states.
- **index.ts**: Barrel export
