# Code Activity Module

Code Activity owns the server-side source of file-write facts for plugin code heartbeats.

`GET /code-activity/sessions/:sessionId/events` resolves the session's actual local execution root. For ordinary chats this is the source Workspace; for isolated Work sessions it is the managed worktree. The route consumes the Workspace module's internal file watcher and emits only stable Workspace identity, relative file path, session identity, and occurrence time. It never reads or sends file contents or absolute paths.

The Web host combines this source with its UI-presence state before publishing `CodeActivityEvent` to plugins. Provider-specific tool events are intentionally not part of this contract, so agent, terminal, editor-save, and other filesystem writes share the same source of truth.

## Files

- **index.ts**: Elysia route and SSE response metadata.
- **model.ts**: Route parameter schema.
- **service.ts**: Session execution-root resolution and metadata-only file event stream.
