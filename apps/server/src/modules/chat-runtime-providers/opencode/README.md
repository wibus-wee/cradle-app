# opencode

OpenCode Chat Runtime 适配器。

本模块拥有 OpenCode native host 生命周期、原生模型发现、prompt 输入投影，以及 OpenCode message part 到 AI SDK chunk 的映射。Cradle Chat Runtime 继续拥有 runtime 选择、持久绑定、队列、会话和消息持久化。

适配器按 `binaryPath + cwd` 池化本地 `opencode serve` 进程，并为 root 与 v2 OpenCode surface 创建绑定该 cwd 的 SDK client。host 在 discovery 或 session 首次使用时懒启动；lease 使用引用计数，最后一个引用释放后保温约五分钟，再关闭空闲进程。不同 workspace 不共享 host，server cwd 使用对应 workspace；未提供 workspace 时使用 Cradle server 的当前 cwd。

OpenCode 进程直接继承用户原生的 config、auth 与 project scope。Cradle 不再设置 `OPENCODE_CONFIG_CONTENT`、`OPENCODE_CONFIG_DIR`、`OPENCODE_DB` 或 `OPENCODE_DISABLE_PROJECT_CONFIG`，也不会向用户 workspace 写入 OpenCode 配置。模型发现并发读取 SDK `provider.list()` 与 `<binary> models --verbose`；SDK connected providers 保持 authoritative，同 ID 使用 SDK descriptor，同时保留 CLI-only provider/model。仅当 verbose flag 不受支持时才回退到 `<binary> models`。普通 Cradle provider target 仍不属于该 runtime 的绑定面，OpenCode 使用自己的 native provider target。

Runtime presentation is provider-owned. `getPresentation()` reads opencode `command.list()` from the live SDK server, exposes those entries as Chat Runtime slash commands, and declares opencode UI slots for quick question, status, model, terminal, progress, diff, approvals, MCP, filesystem, config, and agents surfaces. Submitted composer text that exactly matches a listed `/command` is routed to `session.command()`; other normal turns use `session.promptAsync()` when OpenCode SSE is available and fall back to blocking `session.prompt()` only when subscription setup fails.

Normal turn streaming is event-first. `streamTurn()` subscribes to `event.subscribe()`, records the active session's existing message ids, then sends a prompt through `session.promptAsync()` without overriding OpenCode's message id generation. Assistant `message.updated` events whose ids were not present in that baseline are treated as candidates for the active turn; when a new assistant reaches a terminal state (`finish` is not `tool-calls` or `unknown`), the adapter reads `session.message()` once to recover missed parts before emitting the final AI SDK `finish` chunk. `session.idle` between agent-loop steps does not close the turn; only a truly terminal assistant message or an ended SSE stream triggers completion recovery.

OpenCode permission requests are bridged into Chat Runtime pending tool approvals. `permission.updated` events emit standard AI SDK tool input and `tool-approval-request` chunks with ids shaped as `server-request-${permission.id}` and builtin api name `approval.permissions`. User decisions are returned to OpenCode through `postSessionIdPermissionsPermissionId()` as `once` for approvals and `reject` for denials. Recent permission decisions are retained in-memory for the opencode approvals UI slot.

OpenCode question tools are bridged into Chat Runtime pending user input. When the active session emits a `question` tool part with structured `questions`, the adapter finds the matching v2 pending question request by `tool.callID`, calls `ProviderContext.requestUserInput`, and replies through `v2.session.question.reply()` with answers in OpenCode's original question order.

`/btw` quick questions use a temporary opencode session seeded with Cradle-owned transcript text and are deleted after streaming. This keeps Cradle's no-history quick-question contract without requiring users to define an opencode command. Shell execution uses `session.shell()` against the active opencode session and projects the resulting message parts into the Chat Runtime shell result envelope. Rollback uses the full `session.messages()` history to locate the requested historical assistant message, then calls `session.revert()`; workspace file changes are not reverted.

Provider-native sessions are exposed through Chat Runtime provider-thread APIs. The adapter maps `session.list()`, `session.get()`, `session.messages()`, and `session.delete()` to provider-thread list/read/turns/delete. Side conversations use `forkRuntimeSession()` and OpenCode `session.fork()` when a parent provider session is available, preserving native OpenCode history better than a Cradle transcript-only fallback.

Runtime UI state is read from native OpenCode APIs where the SDK has stable read-only primitives. `getUiSlotStates()` reads `session.status()`, `session.todo()`, `session.diff()`, `mcp.status()`, and `file.status()` on a best-effort basis. The crew slot is projected from task/subagent bindings created by the current provider session, not from the global list of supported OpenCode agents. Failures in one native state endpoint do not fail the whole UI state request. Provider-thread projections include OpenCode share URL, summary, revert metadata, and child session count when available. Cradle still does not expose user-facing OpenCode MCP lifecycle controls for `mcp.add()`, `mcp.connect()`, `mcp.disconnect()`, or `mcp.auth.*`; MCP state and configuration come from the user's native OpenCode scope.

Input projection preserves text and AI SDK file parts. `input-projector.ts` maps text parts to OpenCode text parts and file/image parts with `mediaType`, `filename`, and `url` to OpenCode `FilePartInput`.

Title generation runs opportunistically after the first successful turn and explicit regeneration uses the same provider hook. Both paths call opencode `session.summarize()` with `small_model` when configured, then read the updated session title through `session.get()` and write the cleaned title back through `session.update()`. In `@opencode-ai/sdk@1.17.11`, `session.summarize()` returns a boolean rather than the title string.

Runtime settings are supported for interaction mode: Cradle `default` mode maps to OpenCode `build` agent and Cradle `plan` mode maps to OpenCode `plan` agent. `updateRuntimeSettings()` is intentionally a no-op because OpenCode mode is applied per turn from Chat Runtime provider options rather than persisted into global OpenCode config.

Live steer-turn is not declared for opencode. The current Chat Runtime `steerTurn` hook is a live-turn operation without workspace/model/system-prompt context, while opencode exposes revert/unrevert primitives rather than an active-turn steer API.

OpenCode SDK 1.17.11 exposes session-scoped v2 question list/reply endpoints. The root event stream still surfaces question activity as normal `question` tool parts, so the adapter uses the tool part for Chat Runtime projection and the v2 session question endpoint for the native reply.

## Files

- `metadata.ts`: runtime identity and static capability metadata.
- `presentation.ts`: opencode command and UI slot projection.
- `config.ts`: OpenCode model selection projection retained at the provider boundary; it is not injected into the native host environment.
- `runtime-context.ts`: cwd-scoped OpenCode SDK server pool and managed-process lifecycle.
- `model-inventory.ts`: concurrent SDK/CLI model discovery, parsing, and descriptor merge.
- `input-projector.ts`: Chat Runtime message input to opencode prompt parts.
- `event-to-chunk-mapper.ts`: opencode prompt result parts to AI SDK `UIMessageChunk` events.
- `event-stream.ts`: opencode live event to AI SDK chunk projection and async prompt terminal detection.
- `tools/`: Cradle-owned stable tool envelope projection for opencode tool parts.
- `provider.ts`: `ChatRuntime` facade for session start/resume/fork, event-first prompt turns, permission approvals, provider-thread APIs, shell, rollback, title generation, UI slot states, and cancellation.
