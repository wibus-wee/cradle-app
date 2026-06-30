# Plugins Module

Cradle-owned plugin APIs live in this module. The module reads the runtime plugin registry and exposes app-facing projections such as plugin management descriptors and composer mention candidates.

This module owns host activation APIs. Host activation means Cradle decides whether a plugin package is active at all. It is separate from plugin-owned settings stored in the plugin's own namespace. A plugin setting can change behavior inside an active plugin; host activation decides whether Cradle imports the server entry, serves the web bundle, exposes plugin routes, and registers runtime capabilities.

## Routes

- `GET /plugins` lists host plugin descriptors for management surfaces and generated CLI usage. Descriptors include activation state, layer state, source metadata, declared capabilities, runtime capabilities, warnings, and an `active` projection.
- `GET /plugins/:routeSegment` reads one host plugin descriptor by route segment. The route segment is the URL-safe identifier from the descriptor, not the package identity.
- `PATCH /plugins/:routeSegment/enabled` updates Cradle's activation policy for one plugin and returns the updated descriptor. The request body is `{ enabled: boolean, reason?: string | null }`.
- `GET /plugins/mentions` lists plugin mention candidates for the chat composer. It reads plugin descriptors and capabilities from Cradle's plugin registry; it does not read from or write to MCP registry state.
- `GET /plugins/:routeSegment/icon` reads a plugin-owned package-relative icon declared by `cradle.icon`.

Plugin-owned runtime routes are not stable host APIs. They are dispatched under `/api/plugins/:routeSegment/...` by the plugin host so web plugins can call their own server handlers through `ctx.routes`.
