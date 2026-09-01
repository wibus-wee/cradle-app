# Kimi Runtime Provider

This namespace owns the native Kimi Web adapter for Chat Runtime. `provider.ts` maps Kimi sessions, prompts, native steer/cancel, approvals, questions, background terminals, thread history, runtime settings, and Kimi state into Cradle's runtime contracts and UI slots.

## Approval Modes

The access control maps directly to Kimi's native permission contract: `approval-required` to `manual`, `approve-for-me` to `auto`, and `full-access` to `yolo`. Plan mode remains independent. Settings are applied through the typed session profile endpoint when a session starts and whenever live runtime settings change.

## Protocol Generation

`protocol/` is the committed, generated contract boundary for the locally installed `kimi` executable:

- `openapi.json` and `asyncapi.json` are normalized snapshots fetched from a fresh, temporary `kimi web` instance.
- `MANIFEST.json` records the Kimi version and snapshot SHA-256 values.
- `rest/` and `websocket.ts` are TypeScript bindings generated from the snapshots.

Run `pnpm --filter @cradle/server generate:kimi-web-protocol` to refresh snapshots and bindings after upgrading Kimi. It creates a temporary `KIMI_CODE_HOME`, reads its short-lived server token only to authenticate schema requests, then deletes the home. It does not read or modify `~/.kimi-code`.

Run `pnpm --filter @cradle/server generate:kimi-web-protocol-bindings` to rebuild bindings from committed snapshots without launching Kimi. Do not hand-edit generated files.

## REST Client

`http/client.ts` is the only hand-written REST transport boundary. It creates a generated `@hey-api/client-ofetch` client for one Kimi host, injects the host base URL and temporary bearer token, applies an ofetch timeout with retries disabled, and unwraps Kimi's standard response envelope. Runtime adapters call generated functions from `protocol/rest/sdk.gen.ts` with `client: kimiHttp.client`; they do not construct URLs or request bodies themselves.

## Host Ownership

`web-host.ts`, `host-lease.ts`, and `runtime-home.ts` own Kimi process lifecycle.

- Kimi data is always under Cradle's `runtimes/kimi/providers/<provider-target-id>` namespace, never `~/.kimi-code`.
- The process host key is `provider-target:<provider-target-id>`. A chat session is deliberately not part of that key or the fingerprint.
- Therefore `N` provider targets use `N` isolated Kimi homes and hosts, while every Cradle session for one target shares its one Kimi host.
- The host fingerprint includes the target's Kimi provider projection and a non-reversible credential fingerprint. Changing either replaces the host; raw credentials and Kimi's loopback bearer token are not persisted in Chat Runtime state.

## Session Storage

Kimi session state remains inside its provider target home. Storage cleanup
removes the exact `sessions/<workspace>/<session-id>` directory, matching event
journal, and `session_index.jsonl` entry, then invalidates the rebuildable query
cache. It never scans or deletes `~/.kimi-code`. Explicit cleanup stops an idle
target host first; a target shared by another active session is rejected.

Storage Maintenance runs on startup and hourly. It deletes only native session
artifacts whose `(provider target, session id)` pair has no surviving Cradle
binding, and skips every running target. A bound directory with malformed state
is preserved because corruption alone is not proof that the user no longer
owns the session.

## Streaming Lifecycle

The shared host WebSocket keeps the legacy session subscription for live turn events and adds `subscribe_v2` wildcard transcript subscriptions with per-agent sequence cursors. If the connection closes, the host-owned client reconnects, restores both subscriptions, and sends `transcript_since` cursors. Subscription acknowledgement and `resync_required` trigger authoritative REST transcript hydration: Cradle recovers missing text, thinking, and terminal tool state, resumes pending approval/question bridging, and terminates the stream when the submitted prompt is already completed, failed, aborted, or blocked. A failed bounded reconnect emits a terminal provider error instead of leaving the run active.

Provider thread history comes from Kimi's typed transcript endpoint rather than the legacy message list. Transcript turns preserve timestamps, duration, structured tool frames, tasks, subagents, and retry metadata; task/subagent state is projected into the shared progress and crew UI slots. Live events carrying a non-main `agentId` use an isolated chunk mapper and publish through provider-thread events, so child output and terminal boundaries never enter the parent transcript. Child-agent transcript metadata supplies each existing crew call's native `model` and `thinkingEffort` projection without adding another shared contract. Live `agent.status.updated` usage is projected into durable Cradle usage events with model, provider timestamp, current-turn totals, cumulative totals, cache-read tokens, and cache-write tokens. Native config warnings, model-catalog refresh failures, and MCP failed/needs-auth states use the runtime warning stream; neutral catalog/config changes and healthy MCP status remain provider-owned facts.

Prompt submission uses a handwritten projector over the generated `SubmitPromptData` contract. It preserves text, native Kimi skill selections, image/video base64 and remote URLs, local media paths, and local files for both normal turns and steer. Cradle plugin mentions remain explicit text context. A shape Kimi cannot represent, such as a remote non-media file URL, fails before submission instead of silently disappearing.

Native Kimi capabilities that lack a corresponding Cradle contract are documented in [`GAP.md`](./GAP.md), rather than being advertised as supported behavior.
