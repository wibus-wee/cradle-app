# Plugins Module

Cradle-owned plugin APIs live in this module. The module reads the runtime plugin registry and exposes app-facing projections such as plugin management descriptors and composer mention candidates.

This module owns host activation APIs. Host activation means Cradle decides whether a plugin package is active at all. It is separate from plugin-owned settings stored in the plugin's own namespace. A plugin setting can change behavior inside an active plugin; host activation decides whether Cradle imports the server entry, serves the web bundle, exposes plugin routes, and registers runtime capabilities.

## Route map

| Surface | Routes | Responsibility |
| --- | --- | --- |
| Descriptor management | `GET /plugins`, `GET /plugins/:routeSegment`, `PATCH /plugins/:routeSegment/enabled` | Projects runtime, activation, trust, permission, and capability state; activation records checksum-bound package trust and exact reviewed permission grants. |
| Composer and assets | `GET /plugins/mentions`, `GET /plugins/:routeSegment/icon` | Projects mention candidates and validated package-relative icons without owning Plugin behavior. |
| Persistent sources | `GET|POST /plugins/sources`, `GET /plugins/sources/:id`, `POST /plugins/sources/preview`, `POST /plugins/sources/:id/refresh` | Resolves local, Git, and npm sources and projects their cached packages. Read routes never download, pack, extract, or publish. |
| Personal Plugins | `POST /plugins/personal`, `POST /plugins/personal/:sourceId` | Packs a retained authoring directory into a validated Cradle-owned snapshot. Update publishes through staging so build or validation failure preserves the prior snapshot. |
| Uninstall | `GET /plugins/sources/:id/uninstall-plan`, `DELETE /plugins/sources/:id` | Inspects and confirms Plugin cleanup before deleting records and Cradle-owned snapshots. Personal authoring directories are retained. |
| Development sessions | `GET|POST /plugins/dev-sessions`, `POST /plugins/dev-sessions/:id/reload`, `POST /plugins/dev-sessions/:id/heartbeat`, `DELETE /plugins/dev-sessions/:id` | Owns attached, memory-only watch sessions that expire after 45 seconds without a CLI heartbeat and never write persistent source or trust records. |
| Plugin events and review handoff | `GET /plugins/events`, `GET /plugins/reviews?chatSessionId=...` | Multiplexes persisted lifecycle and development-session events for Web/Desktop reconciliation, and projects memory-only pending reviews into the Chat Session that initiated an Agent install or update. Consumers dispatch by event scope and fetch authoritative projections after lifecycle events. |

GitHub archives are downloaded through the server Download Center; the Plugin
host owns extraction, package discovery, trust evaluation, and cache
publication. Concurrent operations for the same
`{ kind, location, ref, subPath }` share one cache-keyed operation. Personal
Plugin snapshots instead use the package's standard `npm pack` boundary after
the CLI completes its package-owned build.

Enabling an `externalLocal` plugin records package trust plus one permission grant per reviewed manifest permission for the currently discovered package checksum. These grants are host policy, not plugin-owned settings. If the package contents change, the checksum changes and Cradle disables every runtime layer until the operator reviews that exact package revision again. External local plugins remain blocked while the server is enrolled as a Fabric node.

Plugin-owned runtime routes are not stable host APIs. They are dispatched under `/api/plugins/:routeSegment/...` by the plugin host so web plugins can call their own server handlers through `ctx.routes`.

## Development mode

`cradle plugin dev` owns source compilation and sends only successful Vite builds to this module. The server imports server bundles with a monotonically increasing revision query so native ESM caching cannot retain an older build. Renderer and Electron main subscribe to the session projection and reload only their owned layers. Stopping a session deactivates the temporary plugin and restores a same-identity plugin that was active before development began.
