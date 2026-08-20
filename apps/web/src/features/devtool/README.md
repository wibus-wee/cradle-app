<!-- Once this directory changes, update this README.md -->

# Features/Devtool

Developer tooling feature with runtime diagnostics for observability, health, memory, route surface state, and plugin runtime state.
Rendered at the `/devtool` route in a separate Electron window or at `#/devtool` in the web app.
The root page owns the devtool tab model and window-level `Cmd/Ctrl + 1..5` tab switching listener.
User-facing diagnostic labels and status text are owned by the `devtool` i18n namespace.

| Area | Location | Responsibility |
| --- | --- | --- |
| Window shell | [`ipc-devtool-page.tsx`](./ipc-devtool-page.tsx) | Composes the devtool panels and owns `Cmd/Ctrl + 1..5` tab switching. |
| IPC and ACP | [`ipc`](./ipc), [`acp`](./acp), [`flow-color.ts`](./flow-color.ts) | Inspects typed renderer/main IPC and ACP protocol events with shared flow colors. |
| Agent context | [`agent-context`](./agent-context) | Displays context snapshots captured before provider stream execution. |
| Observability | [`observability`](./observability) | Inspects canonical events and incidents and exposes local export controls. |
| Plugins | [`plugins`](./plugins) | Diagnoses discovery, layers, contributions, client panels, and commands. |
| Resources | [`resources`](./resources) | Separates the Server-querying container from a fixture-renderable View and reports renderer, Server, managed Relay, runtime, CLI TUI, and bottom-panel memory/CPU with partial failure feedback. |
| Background work | [`background-activity`](./background-activity) | Displays the Server-owned registry of maintenance and runtime activity in the dev footer. |
| Surfaces | [`surfaces`](./surfaces) | Diagnoses active routes, opened surfaces, ordering, and owner identity. |
| Health and memory | [`health`](./health), [`memory`](./memory) | Displays localized Server health, renderer memory, and Web Vitals. |

[`ipc-devtool-page.test.tsx`](./ipc-devtool-page.test.tsx) owns the devtool tab
shortcut regression coverage. [`index.ts`](./index.ts) is the public feature
barrel.
