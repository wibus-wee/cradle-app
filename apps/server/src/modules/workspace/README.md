# Workspace Module

The Workspace module owns workspace records, filesystem capability routing, and the explicit confirmation boundary for writes to user-owned project directories. A workspace locator names either this Server (`nodeId: "local"`) or another Fabric Node; callers use the same `/workspaces/:id/*` contract in both cases.

| Area                         | Owner                              | Contract                                                                                                                                                                  |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Records and locators         | [`service.ts`](./service.ts)       | Stores local workspaces and remote Node projections, resolves historical identities, tracks availability and pinning, and keeps a remote projection aligned after relink. |
| HTTP and CLI surface         | [`index.ts`](./index.ts)           | Exposes `/workspaces` routes, OpenAPI metadata, and generated CLI descriptors. Streaming endpoints are intentionally not CLI commands.                                    |
| Request and response schemas | [`model.ts`](./model.ts)           | Defines workspace records, file operations, rich preview metadata, migration payloads, and non-Cradle-owned write boundary responses.                                     |
| File operations              | [`files.ts`](./files.ts)           | Performs path-contained local listing, search, preview, text and binary I/O, create, rename, and Office-to-PDF rendition work.                                            |
| Change events                | [`file-watch.ts`](./file-watch.ts) | Shares local `fs.watch` subscriptions, invalidates indexes, and emits debounced directory refresh hints.                                                                  |

## Local And Node Workspaces

Local workspace operations execute against the locator path on this Server. For a remote projection, the service resolves the target workspace by its stable `sourceWorkspaceId`, falling back to the Node path when needed, and sends the same operation through the Fabric upstream connection. The target Node remains authoritative for filesystem access, path containment, write confirmation, file watching, and rendition resources.

Remote projections support the complete workspace file surface: full and shallow listing, fuzzy search, text and metadata reads, raw bytes, PDF renditions, SSE file-change events, file writes, file and folder creation, and rename. Streaming and binary routes transparently return the target Node response so status, headers, cancellation, and backpressure retain their HTTP semantics. Relink succeeds on the target Node before the controller updates the projection locator and Git identity.

## Write Boundary

Workspace file writes target non-Cradle-owned user directories. Write, create, and rename requests must include `confirmedNonCradleOwnedWrite: true`; the controller checks that confirmation before forwarding and the target Node enforces the same contract. Successful responses identify the workspace path, relative path, and resolved target in `ownerBoundary` metadata.

## Explorer And Preview

Workspace Explorer uses a VS Code-style shallow model. `/workspaces/:id/files/children?path=` reads direct children, follows resolvable symlink files and directories, skips generated directories such as `.git` and `node_modules`, and honors root `.gitignore`. `/workspaces/:id/files/search?q=&limit=` uses the workspace-owned FFF index and merges bounded symlink-subtree results. Slash-suffixed searches perform shallow directory completion.

`/workspaces/:id/files/events` emits SSE directory refresh hints so loaded directories and ancestors can refresh without full rescans. The same local watcher supplies metadata-only relative file changes to Code Activity; the public Explorer stream remains directory-only.

Full listing remains bounded for consumers that need broad workspace paths. The service supplements FFF results with workspace-owned directory entries so empty folders remain visible, invalidates cached indexes after mutations, prunes idle entries, and caps retained workspace roots.

Preview metadata classifies known extensions and sniffs unknown file headers so source files are not treated as generic binary data. Raw preview reads never write to the workspace. Office renditions use LibreOffice/`soffice` on the owning Node and cache generated PDFs under that Server's `workspace/renditions` data namespace.

## Cradle-Owned Workspaces

When a Session has no selected project, the module creates an ad-hoc workspace under `~/Documents/Cradle/YYYY-MM-DD/<timestamp-id>` and registers it as a normal local workspace.

With the `multiWorkspacePoc` feature enabled, `/workspaces/multi-folder` creates a Cradle-owned symlink root under `~/Documents/Cradle/workspaces/<name>/`. Members must be registered local single-folder workspaces; arbitrary paths and nested multi-folder workspaces are rejected. The module writes only the composite root and `cradle-workspace.json`, never linked project contents. Work is unsupported because the composite has no single primary Git root.
