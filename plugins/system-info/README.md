# System Info Plugin

System Info is the reference plugin for Cradle's server route, web panel, web command, and web notification SDK surfaces.

## Runtime Surfaces

- `src/server.ts`: Registers `GET /info` under the plugin route segment and returns host system metadata.
- `src/web.tsx`: Registers the sidebar panel, fetches `/info` through `ctx.routes`, and renders the system snapshot with host UI primitives plus host-owned numeric display helpers.
- `command.show-snapshot`: Registers `Show System Info Snapshot` in the host command palette, fetches `/info`, stores `lastCheck`, and sends a success or error toast through `ctx.notifications`.
- `command.check-memory-pressure`: Registers `Check Memory Pressure` in the host command palette and sends a success or warning toast based on memory usage.

## Validation Role

This plugin intentionally exercises plugin-owned command handlers through the app-wide command palette. It also verifies that web plugins do not import the app toast manager directly; notifications must flow through the SDK `ctx.notifications.show()` bridge so the host owns rendering, scoping, and lifecycle.
