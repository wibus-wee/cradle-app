# opencode

opencode Chat Runtime adapter.

This package owns opencode-native server lifecycle, provider config projection, prompt input projection, and opencode message-part to AI SDK chunk mapping. Cradle Chat Runtime owns runtime selection, durable binding, queues, sessions, and persistence.

The adapter launches one shared local `opencode serve` process and creates an SDK client with `createOpencodeClient({ baseUrl })`. It does not support external client-only mode yet. Cradle provider targets are projected into opencode-native `config.provider[...]` entries and `config.model` values shaped as `providerID/modelID`. Cradle plugin-registered MCP servers are projected into opencode-native `config.mcp[...]` entries. Runtime-owned provider and MCP config is injected at server startup through `OPENCODE_CONFIG_CONTENT`. The opencode process cwd, `OPENCODE_CONFIG_DIR`, and `OPENCODE_DB` are kept under Cradle's data runtime directory, and `OPENCODE_DISABLE_PROJECT_CONFIG=1` prevents project-level `config.json` writes into user workspaces. Native opencode details stay under this package instead of expanding the generic Provider API.

Runtime presentation is provider-owned. `getPresentation()` reads opencode `command.list()` from the live SDK server, exposes those entries as Chat Runtime slash commands, and declares opencode UI slots for quick question, status, model, terminal, progress, diff, approvals, MCP, filesystem, config, and agents surfaces. Submitted composer text that exactly matches a listed `/command` is routed to `session.command()`; other normal turns use `session.promptAsync()` when OpenCode SSE is available and fall back to blocking `session.prompt()` only when subscription setup fails.

Normal turn streaming is event-first. `streamTurn()` subscribes to `event.subscribe()`, records the active session's existing message ids, then sends a prompt through `session.promptAsync()` without overriding OpenCode's message id generation. Assistant `message.updated` events whose ids were not present in that baseline are treated as candidates for the active turn; when a new assistant reaches a terminal state, the adapter reads `session.message()` once to recover missed parts before emitting the final AI SDK `finish` chunk. The stream projector handles text deltas that arrive before part snapshots, avoids replaying text already emitted from SSE, and ignores pre-baseline messages that may appear on the event stream.

OpenCode permission requests are bridged into Chat Runtime pending tool approvals. `permission.updated` events emit standard AI SDK tool input and `tool-approval-request` chunks with ids shaped as `server-request-${permission.id}` and builtin api name `approval.permissions`. User decisions are returned to OpenCode through `postSessionIdPermissionsPermissionId()` as `once` for approvals and `reject` for denials. Recent permission decisions are retained in-memory for the opencode approvals UI slot.

`/btw` quick questions use a temporary opencode session seeded with Cradle-owned transcript text and are deleted after streaming. This keeps Cradle's no-history quick-question contract without requiring users to define an opencode command. Shell execution uses `session.shell()` against the active opencode session and projects the resulting message parts into the Chat Runtime shell result envelope. Rollback uses `session.messages()` to locate the latest assistant message, then calls `session.revert()`; workspace file changes are not reverted.

Provider-native sessions are exposed through Chat Runtime provider-thread APIs. The adapter maps `session.list()`, `session.get()`, `session.messages()`, and `session.delete()` to provider-thread list/read/turns/delete. Side conversations use `forkRuntimeSession()` and OpenCode `session.fork()` when a parent provider session is available, preserving native OpenCode history better than a Cradle transcript-only fallback.

Runtime UI state is read from native OpenCode APIs where the SDK has stable read-only primitives. `getUiSlotStates()` reads `session.status()`, `session.todo()`, `session.diff()`, `mcp.status()`, `file.status()`, and `app.agents()` on a best-effort basis. Failures in one native state endpoint do not fail the whole UI state request. Provider-thread projections include OpenCode share URL, summary, revert metadata, and child session count when available. Cradle still does not expose user-facing OpenCode MCP lifecycle controls for `mcp.add()`, `mcp.connect()`, `mcp.disconnect()`, or `mcp.auth.*`; plugin MCP registration is handled through Cradle's plugin registry and startup config projection.

Input projection preserves text and AI SDK file parts. `input-projector.ts` maps text parts to OpenCode text parts and file/image parts with `mediaType`, `filename`, and `url` to OpenCode `FilePartInput`.

Title regeneration uses opencode `session.summarize()` with `small_model` when configured, then reads the updated session title through `session.get()`. In `@opencode-ai/sdk@1.17.11`, `session.summarize()` returns a boolean rather than the title string.

Runtime settings are supported for interaction mode: Cradle `default` mode maps to OpenCode `build` agent and Cradle `plan` mode maps to OpenCode `plan` agent. `updateRuntimeSettings()` is intentionally a no-op because OpenCode mode is applied per turn from Chat Runtime provider options rather than persisted into global OpenCode config.

Live steer-turn is not declared for opencode. The current Chat Runtime `steerTurn` hook is a live-turn operation without workspace/model/system-prompt context, while opencode exposes revert/unrevert primitives rather than an active-turn steer API.

OpenCode SDK 1.17.11 does not expose structured `question.*` events or a question reply endpoint. Cradle already has a generic pending user-input route and UI, but this adapter only wires native capabilities that exist in the installed SDK; it should not fabricate an OpenCode user-input bridge until the SDK adds a real primitive.

## Files

- `metadata.ts`: runtime identity and static capability metadata.
- `presentation.ts`: opencode command and UI slot projection.
- `config.ts`: Cradle provider target to opencode `Config` projection.
- `runtime-context.ts`: opencode SDK server host resource acquisition.
- `input-projector.ts`: Chat Runtime message input to opencode prompt parts.
- `event-to-chunk-mapper.ts`: opencode prompt result parts to AI SDK `UIMessageChunk` events.
- `event-stream.ts`: opencode live event to AI SDK chunk projection and async prompt terminal detection.
- `tools/`: Cradle-owned stable tool envelope projection for opencode tool parts.
- `provider.ts`: `ChatRuntime` facade for session start/resume/fork, event-first prompt turns, permission approvals, provider-thread APIs, shell, rollback, title generation, UI slot states, and cancellation.
