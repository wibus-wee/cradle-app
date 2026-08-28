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

## Streaming Lifecycle

The shared host WebSocket keeps the legacy session subscription for live turn events and adds `subscribe_v2` wildcard transcript subscriptions with per-agent sequence cursors. If the connection closes, the host-owned client reconnects, restores both subscriptions, and sends `transcript_since` cursors. Subscription acknowledgement and `resync_required` trigger authoritative REST transcript hydration: Cradle recovers missing text, thinking, and terminal tool state, resumes pending approval/question bridging, and terminates the stream when the submitted prompt is already completed, failed, aborted, or blocked. A failed bounded reconnect emits a terminal provider error instead of leaving the run active.

Provider thread history comes from Kimi's typed transcript endpoint rather than the legacy message list. Transcript turns preserve timestamps, duration, structured tool frames, tasks, subagents, and retry metadata; task/subagent state is projected into the shared progress and crew UI slots. Child-agent transcript metadata supplies each existing crew call's native `model` and `thinkingEffort` projection without adding another shared contract. Live `agent.status.updated` usage is projected into durable Cradle usage events with model, provider timestamp, current-turn totals, cumulative totals, cache-read tokens, and cache-write tokens.

Native Kimi capabilities that lack a corresponding Cradle contract are documented in [`GAP.md`](./GAP.md), rather than being advertised as supported behavior.
