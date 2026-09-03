# ACP Chat Runtime

This module projects an Agent Client Protocol (ACP) agent into Cradle's shared Chat Runtime. It owns protocol negotiation, process and native-session lifecycle, ACP-to-Cradle event mapping, interaction bridges, and runtime presentation. Installed-agent records and authentication selections remain owned by [`modules/acp`](../../acp/README.md); remote transport credential values remain owned by `modules/secrets`.

| Area | Owner | Responsibility |
| --- | --- | --- |
| Connection and process | [`connection-manager.ts`](./connection-manager.ts), [`process-manager.ts`](./process-manager.ts) | Connect one target-scoped stdio, HTTP, or WebSocket client, initialize ACP, apply request deadlines, retry cold startup with a bounded policy, and surface redacted process diagnostics. |
| Native sessions | [`provider.ts`](./provider.ts) | Create, resume, load, fork, list, close, and delete ACP sessions; expire abandoned draft sessions; bind native IDs to Chat Runtime sessions. |
| Prompts and timeline | [`input-projector.ts`](./input-projector.ts), [`timeline-mapper.ts`](./timeline-mapper.ts) | Preserve text, image, audio, resource, usage, plan, command, and canonical tool facts at the ACP boundary. |
| Interactions | [`runtime-integration.ts`](./runtime-integration.ts), [`terminal-host.ts`](./terminal-host.ts) | Bridge exact permission options, form/URL elicitation, filesystem access, and terminal execution through shared approval and user-input owners. |
| Presentation | [`presentation.ts`](./presentation.ts) | Project native slash commands, modes, plans, context usage, terminals, and pending user input into typed runtime slots. |
| Tool identity | [`tools`](./tools) | Map exact ACP tool kinds into canonical Cradle tool payloads while preserving native input, output, content, locations, and metadata. |

## Connection and authentication

Initialization sends the server package version and requires the agent to return the SDK `PROTOCOL_VERSION`. A connection is published only after negotiation and the selected authentication method succeed. Cold startup uses three bounded attempts; authentication failures are never retried. A process disconnect fails active channels so the Chat Runtime run owner can terminate the stream, release the run lease, and reconnect on the next operation.

An installed agent stores only an auth method ID. Stable ACP methods are agent-managed or terminal-based: Cradle runs agent-managed authentication on the initialized connection and advertises terminal methods as unsupported because it does not host an interactive terminal authentication flow. The removed experimental environment-variable method is not projected into Cradle's contracts or startup lifecycle.

Remote targets use the SDK HTTP or WebSocket transport selected by the ACP-owned connection record. Header values are resolved from Secrets only while connecting. HTTP cookies remain in a target-scoped in-memory SDK cookie store across reconnects and are cleared on explicit disconnect; they are never persisted by Chat Runtime.

Structured `auth_required` failures carry an ACP configuration target into the shared Chat Runtime recovery owner. The failed durable queue item remains historical. The transcript can render the ACP authentication form inline and, after successful configuration, enqueue an exact copy of the failed text, files, context, model, thinking effort, runtime settings, provider target, and queue/steer mode. Dismissal closes only the recovery record.

Metadata requests have a 30-second deadline, authentication has a five-minute deadline, and prompts have a ten-minute deadline. A timeout sends best-effort `session/cancel`, closes the connection, fails every active channel, and stops the process. Bounded stderr is retained in process diagnostics and included in disconnect errors. ACP authentication no longer injects credential values into the local process environment.

## Sessions and turns

Session creation, load, resume, fork, list, delete, close, prompts, cancellation, mode changes, and config-option writes use typed SDK methods. Resume falls back only for exact method-not-found (`-32601`) and resource-not-found (`-32002`) responses; authentication, process, timeout, and protocol errors remain failures.

Draft model discovery creates a real native session. Starting a chat consumes that session; an abandoned draft expires after ten minutes or can be closed through `DELETE /acp/agents/:agentId/draft-session/:sessionId`. Deleting a bound Chat Runtime session calls native delete or close when the owning connection is live.

A native session accepts one active prompt. Normal completion flushes mapper state and emits one finish chunk using the ACP stop reason. User cancellation closes the local stream without fabricating completion. Process loss fails the stream and leaves terminal run state to the server active-run registry.

Every session lifecycle request receives the registered MCP projection for that chat: stdio servers include their command environment, while streamable HTTP servers include their URL and headers.

## Content and tools

Outbound prompts preserve text plus rich composer file parts. Base64 image and audio data URLs become native image/audio blocks; other URLs become resource links. Inbound images, audio, resource links, embedded text, and embedded blobs become AI SDK text or file chunks.

ACP tool kinds are mapped by exact protocol values. Every tool publishes canonical input, even when `rawInput` is absent. Input and result payloads retain native content blocks, locations, raw values, and `_meta`, allowing shared typed tool rendering without reconstructing ACP semantics from labels.

## Interactions and client capabilities

Native permission choices retain their stable `optionId`, label, and exact `allow_once`, `allow_always`, `reject_once`, or `reject_always` meaning through the approval card and resolution API. Filesystem reads and writes and terminal creation are fail-closed and emit the same approval flow before touching client-owned resources.

The client advertises filesystem, terminal, plan, config-option, and form/URL elicitation capabilities only because handlers exist. Form elicitation maps supported schema properties into typed questions. URL elicitation exposes only HTTP(S) links in the user-input surface, and the matching `elicitation/complete` notification resolves that pending request. Terminal output is bounded; wait, kill, release, and background-terminal listing use the shared terminal contracts.

## Dynamic state

The connection cache owns native mode, config-option, command, plan, and usage snapshots. `available_commands_update`, `current_mode_update`, plan updates/removal, and usage updates mutate that snapshot. Runtime capability and slot queries read the same state used by mode actions and composer controls, so passive windows and resumed sessions do not infer state from transcript text.

See [`GAP.md`](./GAP.md) for intentionally unsupported protocol surfaces and verification limits.
