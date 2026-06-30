# Claude Agent Runtime Provider

Owns the Claude Agent SDK adapter for Chat Runtime. This provider translates Cradle `UIMessage` turns into Claude Agent SDK streaming input and maps SDK output back into AI SDK `UIMessageChunk` events.

Selected chat Skills arrive as Cradle-owned `data-cradle-skill` message parts. The provider removes them from the text/image input blocks and merges their names into Claude Agent SDK `queryOptions.skills` unless the profile already enables `skills: "all"`.

Claude SDK persistence is enabled for API-key main chat turns, and that SDK config root is pinned to Cradle-owned runtime data through `CLAUDE_CONFIG_DIR`. The path follows the Codex app-server convention: `CRADLE_DATA_DIR/runtimes/claude-agent`, then `dirname(CRADLE_DB_PATH)/runtimes/claude-agent`, then `~/.cradle/runtimes/claude-agent`. This lets the SDK own native JSONL transcripts for resume without writing new sessions into the user's `~/.claude/projects` namespace.

Official Claude.ai subscription auth intentionally does not set Cradle's `CLAUDE_CONFIG_DIR`. If the user's shell provides a custom Claude config directory, Cradle preserves it; otherwise the SDK and CLI read the user's normal Claude login state from the default Claude config / secure-storage path. Main turns in this auth mode set `persistSession: false`, so Cradle does not ask the SDK to write native resumable transcripts into the user's `~/.claude/projects`; Cradle-owned chat history is replayed into each turn instead. A future SDK `SessionStore` integration could restore native resume while keeping auth-root and transcript-root ownership separate.

Claude session titles are read from SDK session metadata with `getSessionInfo()` after a provider session id is known, then reported through Chat Runtime's title callback. SDK session metadata reads and `renameSession()` writes are scoped to the same Cradle-owned SDK config root and the active SDK project `cwd`. Cradle owns the final `sessions.title` write.

Agent-scoped Claude Agent sessions use `~/.cradle/agents/{agentId}` as SDK `cwd`. The original project workspace remains explicit through SDK `additionalDirectories` and `CRADLE_WORKSPACE_PATH`; agent context is also passed through `CRADLE_AGENT_ID` and `CRADLE_AGENT_HOME`. The agent home is initialized by the Skills module, including `.agents/skills` and `.claude/skills` links to the Cradle-owned agent `skills/` directory.

Stored Cradle chats with a provider session id pass SDK `resume`, allowing Claude Agent to restore its native transcript. Fresh SDK sessions and provider-target switches still replay bounded Cradle-owned history into the first prompt. Resumed SDK sessions do not replay normal Cradle user/assistant messages into the prompt, because those messages already live in the SDK transcript; they only replay recent Cradle-local context such as local bang-command output that may not exist in the SDK transcript.

Stored turns pass the resolved model through SDK query options and model alias environment variables. When a persisted SDK session is resumed and the requested model differs from the snapshot model, the provider applies the switch through SDK `setModel()`.

Claude SDK `EnterPlanMode` is intercepted as a provider-owned request to switch Cradle's session `interactionMode` to `plan` through Chat Runtime settings, so composer state and the active SDK permission mode share one owner. Claude SDK `ExitPlanMode` remains available in SDK plan mode as the provider-owned signal for submitting a proposed plan. Cradle captures that tool input into its existing tool chunk envelope, stores the latest captured plan in the Claude Agent provider snapshot, exposes it through the runtime-neutral `plan` UI slot, projects a synthetic `plan_implementation` approval so the renderer can submit `PLEASE IMPLEMENT THIS PLAN:` as an ordinary follow-up, denies the native exit action, and keeps runtime interaction state changes owned by Chat Runtime settings.

Claude SDK `TodoWrite` remains a Claude-owned tool, but the adapter also projects the latest normalized todo list into the Claude Agent provider snapshot and exposes it as the runtime-neutral `progress` UI slot. Claude SDK `TaskCreate`, `TaskUpdate`, and `TaskList` also feed the same progress slot when the SDK provides structured task input/output such as `tool_use_result`; the adapter does not parse human-facing task result strings for IDs. The tool result payload still carries `result.pluginState.todos` for TodoWrite transcript rendering; the provider snapshot is the source for composer-adjacent live progress state.

## Files

- `provider.ts`: Claude Agent `ChatRuntime` implementation; starts or resumes SDK sessions, resolves agent-scoped runtime cwd, projects SDK session titles to Chat Runtime, forwards MCP servers, streams turns, and handles live steering, cancellation, context usage reads, session title generation, and Cradle runtime settings updates through SDK permission mode projection.
- `provider.test.ts`: Regression tests for Claude Agent SDK options, title projection, MCP forwarding, history projection, streaming, steering, attachments, model switching, and tool chunk mapping.
- `metadata.ts`: Claude Agent runtime kind, catalog metadata, static capabilities, slash-command presentation projection, and static runtime UI slots.
- `types.ts`: Claude Agent provider-private content and session-info types shared by package modules.
- `runtime-context.ts`: Resolves per-session Claude Agent cwd, agent home, project workspace path, SDK additional directories, and the Cradle-owned SDK config root used by API-key mode.
- `input-projector.ts`: Projects Cradle message input, history, selected Skills, provider config, and environment into Claude Agent SDK content and query options.
- `context-usage-projector.ts`: Projects Claude Agent SDK context usage control responses into Chat Runtime context usage details and compact UI slot state.
- `async-input-stream.ts`: Claude Agent SDK async user-message input stream built on shared provider queue infrastructure.
- `state-projector.ts`: Projects Claude Agent provider snapshot state such as pending resumed-session model switches, captured plan UI slot state, and captured TodoWrite/Task progress state.
- `event-to-chunk-mapper.ts`: Maps Claude Agent SDK messages into AI SDK `UIMessageChunk` events.
- `subagent-projector.ts`: Projects forwarded subagent chunk streams into nested Cradle subagent output tool payloads.
- `event-to-chunk-mapper.test.ts`: Mapper-level regression tests.
- `tools/`: Claude Code tool identity, todo/task progress projection, and tool envelope mapping.
