# ACP Runtime Gaps

This file records Agent Client Protocol (ACP) capabilities that the current Cradle Chat Runtime projection (`chat-runtime-providers/acp/`) does not implement, implements only partially, or deliberately leaves native-only. They are not exposed as misleading provider behavior. The protocol source of truth is `@agentclientprotocol/sdk` (1.2.1, Zed Industries) plus https://agentclientprotocol.com.

Registry browsing, install/uninstall, local agents, and launch-config overrides live in `apps/server/src/modules/acp/` and are complete for their scope; gaps below concern the chat runtime projection and its surfaces unless stated otherwise.

## Authentication

ACP agents advertise auth requirements through `initialize` → `authMethods` and expect a follow-up `authenticate` request. Cradle never reads `authMethods` and never sends `authenticate`; there is no recovery flow for an `auth_required` error on `session/new`.

### Current effect

- Registry agents that require authentication (API key, OAuth, etc.) cannot be used at all: session creation fails with an unexplained error instead of surfacing a login/auth-method choice.
- `authMethods` metadata is discarded at connect time (connection-manager.ts keeps only capabilities).

### Needed

Persist per-agent auth method selection, send `authenticate` after `initialize` when required, map `auth_required` errors into a typed provider error that the frontend can turn into an auth surface. Temporary credentials stay in memory or the credential store; never in `acp_agents` rows or logs.

## Elicitation

`elicitation/create` lets an agent request structured input (form, or out-of-band URL with `elicitation/complete`). No handler is registered on the client side.

### Current effect

Agents that elicit user input hang or fail mid-turn; there is no question UI and no URL-completion notification path.

## Terminals

The `terminal/*` client methods (`create`, `output`, `wait_for_exit`, `kill`, `release`) require advertising a terminal capability during `initialize`. Cradle does not advertise it and registers none of the handlers.

### Current effect

Agents fall back to shell-through-tool-calls if they support it; otherwise terminal-dependent workflows are unavailable. Cradle has a background-terminal contract elsewhere; projecting it needs an explicit bridge decision before the capability is advertised.

## Prompt content blocks

Outbound prompts are text-only: `session/prompt` always sends a single `{ type: 'text' }` block (connection-manager.ts). Inbound non-text blocks (image, audio, resource_link, resource) are dropped by text extraction (timeline-mapper.ts `extractText`), while attachments composed in the rich composer are rejected at turn time because the server accepts only text.

### Current effect

Image/audio/file inputs silently fail for ACP sessions despite `inputMode: 'rich'` in metadata.ts. Agents returning image or resource content render nothing.

## Dropped session updates

`AcpChunkMapper.convert` handles exactly four update kinds — `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update` — and drops everything else in the default branch (timeline-mapper.ts:28):

| Native update | Lost capability |
|---|---|
| `plan`, `plan_update`, `plan_removed` | Agent plan/TODO display and lifecycle |
| `current_mode_update` | Mode-change awareness (see Session modes) |
| `available_commands_update` | Slash-command discovery and execution |
| `user_message_chunk` | Echo of normalized user input |
| `usage_update` | Incremental token/context usage during a turn |
| `diagnostic` | Agent-emitted diagnostics surface |
| ext updates | Provider-specific `_meta` extensions |

## Session modes

`modes` from `session/new` / `session/load` / `session/resume` responses is cached in `sessionStates` but inert: `session/set_mode` is never sent, `current_mode_update` notifications are dropped, and there is no mode slot in the Chat Runtime contract for ACP.

### Current effect

Users cannot switch agent operating modes (e.g. ask/edit/plan-style modes) from Cradle even when the agent exposes them.

## Slash commands

Without consuming `available_commands_update` there is no command inventory, so the composer cannot offer agent-provided slash commands and prompts beginning with `/` are passed through as literal text.

## Permission option granularity

`session/request_permission` options reach the approval bridge as metadata only. Resolution is binary: `allowAcpPermission` picks the first `allow_*` option and `denyAcpPermission` the first `reject_*` option (runtime-integration.ts:85-101); the caller cannot choose "always allow" over "allow once" or any other semantic option the agent offers.

### Current effect

"Allow always"-style grants degrade to per-call approvals; agents whose options carry distinct semantics (e.g. proceed-without-editing) get an arbitrary choice applied.

### Needed

Extend the tool-approval contract to carry selectable options with stable `optionId`s end-to-end and return the user's exact selection.

## Tool call projection

`ToolCall.kind` is not mapped to `CradleToolKind` (no `tools/identity.ts` / `tools/mapper.ts` for this provider); `content` blocks and `locations` are ignored; output is flattened via JSON stringification (timeline-mapper.ts `stringifyPayload`). Tool names shown in the UI are native display titles, not canonical kinds, so typed tool rendering cannot engage.

### Current effect

All ACP tool calls render as generic unknown tools with stringified payloads, including read/write/edit operations that other runtimes render structurally.

## Lifecycle: reconnect, respawn, stderr

There is no bounded reconnect policy, no automatic respawn after agent-process crash, and stderr is captured only for metrics, never surfaced to users. A crashed process fails open channels with a generic disconnect error and the connection stays down until something restarts it. Usage is captured solely from the final `PromptResponse`; incremental usage updates do not exist in ACP today but any `_meta` variants will need a home.

## Declared degradations

Self-declared in metadata.ts and intentionally left unsupported until a contract owner exists:

- `lastTurnRollback`: ACP has no rollback hook.
- `runtimeSettings`: ACP config changes go through `session/set_config_option` (model switching works in-session); normalizing arbitrary config options into runtime settings is deferred.

## Native session lifecycle methods

Cradle uses `session/new`, `session/load`, `session/resume`, `session/prompt`, `session/cancel`, and `session/set_config_option` — but never `session/list`, `session/delete`, `session/fork`, or `session/close`.

### Current effect

- Deleting a Cradle chat session orphans the native ACP session inside the still-running agent process; there is no cleanup call.
- Abandoned draft sessions (`POST /acp/agents/:agentId/draft-session`) leak a real native session each time; drafts have no delete/close path either.
- No session fork means Cradle cannot branch a conversation natively even when the agent supports it.
- Session discovery is one-way: Cradle cannot enumerate native sessions to reconcile its own records after data loss.

### Needed

A cleanup owner: when Cradle deletes a chat session bound to an ACP durable provider session, call `session/delete`/`session/close` best-effort; add draft-session TTL or explicit close; consider `session/list` for reconciliation.

## Stop reason projection

The `stopReason` of the final `session/prompt` response is ignored. `end_turn`, `cancelled`, refusal, and limit stop reasons all produce the same normal turn end.

### Current effect

Refusals and context/turn limits render as if the agent simply finished; users get no signal that the turn was cut short or declined.

### Needed

Map each ACP stop reason onto the Chat Runtime finish-reason contract before discarding the prompt result.

## Turn concurrency and timeouts

Channels are keyed by native session ID (`conn.channels.set(sessionId, channel)` in `prompt()`), so two overlapping runs on the same native session silently rebind the update stream to the newest channel — the older run stops receiving updates mid-flight. There is also no timeout or abort policy on any agent request: an agent that hangs after accepting `session/prompt` leaves the Cradle run streaming forever.

### Current effect

Concurrent prompts on one session corrupt both timelines; hung agents violate the "never leave a run streaming" lifecycle rule with no terminal failure path.

### Needed

Reject or queue concurrent prompts per native session explicitly; wrap agent requests in a bounded timeout/abort policy that terminates the run and releases the lease on exhaustion.

## Initialization negotiation

`initialize` sends the SDK's `PROTOCOL_VERSION` and hardcodes `clientInfo.version: '1.0.0'`; the negotiated `protocolVersion` and `agentCapabilities` beyond `loadSession`/`resume` from the response are ignored. `_meta` extensibility fields are neither read nor forwarded anywhere.

### Current effect

Version mismatches surface as inscrutable downstream protocol errors instead of a typed unsupported-version failure; capability-dependent features (auth, elicitation, terminals, fork) cannot be gated on what the agent actually advertised because only two flags survive.

### Needed

Capability gating must read the full `InitializeResponse`; the server version should reflect the actual server version.

## Module-level follow-ups

Recorded here for visibility; owned by `modules/acp` plans rather than this provider:

- Local agent registration (`POST /acp/agents`) and launch-config override editing have CLI/API support but no web UI (plans/2026-07-19-acp-local-agents-launch-overrides.md).
- The devtool ACP tab has no event producer calling `recordAcp`, so it renders empty.
- Distribution-type filtering in the web registry list is computed client-side instead of using the platform-aware `/acp/registry/distribution-types` endpoint.
- No e2e coverage exists for any ACP journey (e2e/COVERAGE.md lists `acp` as a user-visible gap namespace).

## Title capability mismatch

metadata.ts declares `supportsTitleGeneration: false`, yet native titles from `session_info_update` are already wired through `reportRuntimeSessionTitle` (runtime-integration.ts `handleSessionTitle`). The declared capability and actual behavior contradict each other; whichever is wrong must change so registry-derived degradations and UI affordances match reality.

## Client filesystem read boundary

`fs/write_text_file` requires explicit user approval before writing (`requestClientFileWriteApproval`), but `fs/read_text_file` serves any absolute path with no approval and no workspace confinement (`readClientTextFile`). The read/write boundary is asymmetric by accident rather than by decision: either confine reads to approved scopes, document why agent-initiated reads are trusted, or route them through the same approval bridge.

## Transports: stdio only

Cradle connects exclusively by spawning a local process and bridging its stdio through `ndJsonStream` (connection-manager.ts `openConnection`). The SDK also ships `@agentclientprotocol/sdk/experimental/http-client` and `/ws-client` for remote HTTP/SSE and WebSocket agents; neither is used, and the `acp_agents` schema (cmd/args/env/install path) cannot express a remote endpoint at all.

### Current effect

Hosted/remote ACP agents cannot be used from Cradle; every registry agent costs a locally installed binary plus a running subprocess, which also blocks browser-only surfaces (web/mobile without a local process spawner) from ever using this runtime.

## Per-agent / per-session MCP configuration

`session/new`, `session/load`, and `session/resume` always inject the same global projection of registered stdio MCP servers (`listRegisteredAcpMcpServers`); there is no way to attach a custom MCP server to a specific ACP agent, chat session, or workspace. The upstream projection itself is limited to stdio (mcp-registry test: "limits the ACP projection to stdio"), so HTTP/SSE MCP servers never reach ACP agents even when registered elsewhere in Cradle.

## Agent credentials in plaintext

Local-agent env maps (typically containing API keys) are JSON-serialized directly into `acp_agents.env`; audit logging records only key names (`envKeysOnly`). There is no secret-store integration, so anyone with DB/file access reads every configured agent credential.
