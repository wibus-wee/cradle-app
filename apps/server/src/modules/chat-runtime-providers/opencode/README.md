# opencode

OpenCode Chat Runtime 适配器。

本模块拥有 OpenCode native host 生命周期、原生模型发现、prompt 输入投影，以及 OpenCode message part 到 AI SDK chunk 的映射。Cradle Chat Runtime 继续拥有 runtime 选择、持久绑定、队列、会话和消息持久化。

适配器与 `@opencode-ai/sdk` 内置于 Server，但 native OpenCode CLI 是显式选装资源，不会在启动、选择 runtime、模型发现或首条消息时自动下载。统一 Resources 页始终声明 `{ opencode, runtime, cli }`；用户可在那里安装、更新或卸载 Cradle 自己管理的 SDK 对齐版本。当前 SDK 与受管 CLI 都固定为 `1.18.21`，发布清单由官方 release 元数据同步并接受审阅。

可执行文件解析顺序是：显式调用参数或 `CRADLE_OPENCODE_PATH` operator override、`<server data>/runtimes/opencode` 下的 Cradle-managed 安装、最后是 PATH。override 和 PATH 文件属于外部 namespace，Cradle 可读取及探测版本，但绝不升级或删除；三者都不存在时，预检在 spawn 前返回稳定的 `opencode_runtime_not_installed`。Chat Runtime 健康检查只执行有超时的 `--version`，不会启动 `opencode serve`，也不会把绝对路径投影给客户端。

适配器按绝对 `binaryPath + cwd` 池化本地 `opencode serve` 进程，并为 root 与 v2 OpenCode surface 创建绑定该 cwd 的 SDK client。host 在 discovery 或 session 首次使用时懒启动；lease 使用引用计数，最后一个引用释放后保温约五分钟，再关闭空闲进程。不同 workspace 不共享 host，server cwd 使用对应 workspace；未提供 workspace 时使用 Cradle server 的当前 cwd。版本切换采用 immutable version directory 与原子 current pointer；既有 session 继续租用旧绝对路径，新 acquisition 使用新版本。活跃或仍在启动的 lease 会阻止卸载，空闲 host 会先停止再删除受管文件。

OpenCode 进程直接继承用户原生的 config、auth 与 project scope。Cradle 不设置 `OPENCODE_CONFIG_CONTENT`、`OPENCODE_CONFIG_DIR`、`OPENCODE_DB` 或 `OPENCODE_DISABLE_PROJECT_CONFIG`，也不会向用户 workspace 写入 OpenCode 配置。只有 Cradle-managed CLI 进程会收到 `OPENCODE_DISABLE_AUTOUPDATE=1`，确保版本更新仍经过 Download Center 校验与原子切换；operator override 和 PATH 进程保留用户自己的生命周期。唯一的例外是权限模式：当会话 accessMode 为 `approval-required` 时，managed host 会收到 `OPENCODE_PERMISSION={"*":"ask"}`——它以 deep-merge 叠加在用户 config 之上且具体工具规则优先，因此只把用户未显式配置的动作强制为 ask；`full-access` 不注入任何内容。模型发现并发读取 SDK `provider.list()` 与 `<binary> models --verbose`；SDK connected providers 保持 authoritative，同 ID 使用 SDK descriptor，同时保留 CLI-only provider/model。仅当 verbose flag 不受支持时才回退到 `<binary> models`。普通 Cradle provider target 仍不属于该 runtime 的绑定面，OpenCode 使用自己的 native provider target。

Runtime presentation is provider-owned. `getPresentation()` reads opencode `command.list()` from the live SDK server, exposes those entries as Chat Runtime slash commands, and declares opencode UI slots for quick question, status, model, terminal, progress, diff, approvals, MCP, filesystem, config, and agents surfaces. Submitted composer text that exactly matches a listed `/command` is routed to `session.command()`; other normal turns use `session.promptAsync()` when OpenCode SSE is available and fall back to blocking `session.prompt()` only when subscription setup fails.

Normal turn streaming is event-first. `streamTurn()` subscribes to `event.subscribe()`, records the active session's existing message ids, then sends a prompt through `session.promptAsync()` without overriding OpenCode's message id generation. Assistant `message.updated` events whose ids were not present in that baseline are treated as candidates for the active turn; when a new assistant reaches a terminal state (`finish` is not `tool-calls` or `unknown`), the adapter reads `session.message()` once to recover missed parts before emitting the final AI SDK `finish` chunk. `session.idle` between agent-loop steps does not close the turn; only a truly terminal assistant message or an ended SSE stream triggers completion recovery.

OpenCode permission requests are bridged into Chat Runtime pending tool approvals. `permission.updated` events emit standard AI SDK tool input and `tool-approval-request` chunks with ids shaped as `server-request-${permission.id}` and builtin api name `approval.permissions`. User decisions are returned to OpenCode through `postSessionIdPermissionsPermissionId()` as `once` for approvals and `reject` for denials. Recent permission decisions are retained in-memory for the opencode approvals UI slot.

OpenCode question tools are bridged into Chat Runtime pending user input through the workspace-scoped `question.list/reply/reject` API owned by OpenCode's `Question.Service`. The adapter filters pending requests by `sessionID`, matches `tool.callID`, calls `ProviderContext.requestUserInput`, and returns answers in the original question order. Legacy and v2 question lifecycle events provide a low-latency trigger, while the structured `question` tool part recovers the request from the authoritative pending list when an event is absent. A running question remains pending in the transcript and is not projected as `Done` before OpenCode reports completion.

`/btw` quick questions use a temporary opencode session seeded with Cradle-owned transcript text and are deleted after streaming. This keeps Cradle's no-history quick-question contract without requiring users to define an opencode command. Shell execution uses `session.shell()` against the active opencode session and projects the resulting message parts into the Chat Runtime shell result envelope. Rollback uses the full `session.messages()` history to locate the requested historical assistant message, then calls `session.revert()`; workspace file changes are not reverted.

Provider-native sessions are exposed through Chat Runtime provider-thread APIs. The adapter maps `session.list()`, `session.get()`, `session.messages()`, and `session.delete()` to provider-thread list/read/turns/delete. Side conversations use `forkRuntimeSession()` and OpenCode `session.fork()` when a parent provider session is available, preserving native OpenCode history better than a Cradle transcript-only fallback.

Runtime UI state is read from native OpenCode APIs where the SDK has stable read-only primitives. `getUiSlotStates()` reads `session.status()`, `session.todo()`, `session.diff()`, `mcp.status()`, and `file.status()` on a best-effort basis. The crew slot is projected from task/subagent bindings created by the current provider session, not from the global list of supported OpenCode agents. Failures in one native state endpoint do not fail the whole UI state request. Provider-thread projections include OpenCode share URL, summary, revert metadata, and child session count when available. Cradle still does not expose user-facing OpenCode MCP lifecycle controls for `mcp.add()`, `mcp.connect()`, `mcp.disconnect()`, or `mcp.auth.*`; MCP state and configuration come from the user's native OpenCode scope.

Input projection preserves text and AI SDK file parts. `input-projector.ts` maps text parts to OpenCode text parts and file/image parts with `mediaType`, `filename`, and `url` to OpenCode `FilePartInput`.

Title generation runs opportunistically after the first successful turn and explicit regeneration uses the same provider hook. Both paths call opencode `session.summarize()` with `small_model` when configured, then read the updated session title through `session.get()` and write the cleaned title back through `session.update()`. In `@opencode-ai/sdk@1.18.21`, `session.summarize()` returns a boolean rather than the title string.

Runtime settings are supported for interaction mode: Cradle `default` mode maps to OpenCode `build` agent and Cradle `plan` mode maps to OpenCode `plan` agent. `updateRuntimeSettings()` is intentionally a no-op because OpenCode mode is applied per turn from Chat Runtime provider options rather than persisted into global OpenCode config.

Live steer-turn is not declared for opencode. The current Chat Runtime `steerTurn` hook is a live-turn operation without workspace/model/system-prompt context, while opencode exposes revert/unrevert primitives rather than an active-turn steer API.

## Files

| Area | Location | Responsibility |
| --- | --- | --- |
| Runtime contract | `metadata.ts`, `presentation.ts`, `provider.ts` | Own runtime identity, UI capabilities, sessions, turns, interactions, and provider hooks. |
| Native host | `runtime-context.ts`, `runtime-installation.ts`, `managed-resource-adapter.ts` | Own the cwd-scoped server pool, executable resolution, health, install, and resource lifecycle. |
| Release identity | `runtime-release.ts`, `opencode-runtime-manifest.json` | Pin the SDK-aligned official CLI release and target artifacts. |
| Model and input projection | `model-inventory.ts`, `config.ts`, `input-projector.ts` | Discover native models and translate Cradle model, prompt, file, and image inputs. |
| Streaming | `event-stream.ts`, `event-to-chunk-mapper.ts` | Translate native events and recovered message parts into valid AI SDK chunks. |
| Tools | `tools/` | Project OpenCode tool calls into Cradle's canonical tool envelopes. |
