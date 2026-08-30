# Kimi Runtime Gaps

This file records native Kimi Web capabilities that the current Cradle Chat Runtime contract cannot represent without changing the contract. They are deliberately not exposed as misleading provider behavior.

Kimi's native `permission_mode: auto` is projected as the shared `approve-for-me` access mode. It is intentionally distinct from `yolo` full access and from persistent "always allow" permission rules in other runtimes.

## Session deletion

Kimi Web exposes `POST /api/v1/sessions/{session_id}:archive`, but no irreversible session-delete operation. Cradle's `deleteProviderThread` contract promises deletion, so the Kimi provider does not implement it. Archive remains available in Kimi itself and is returned by provider-thread listing when requested.

## Background task control

Kimi exposes typed task list, inspect, and cancel operations (`cancelTask`). Cradle projects task state into the `progress` UI slot, but has no session-scoped task-control contract or UI action owner. The provider therefore does not expose cancel as a terminal or turn cancellation surrogate.

## Target-scoped model inventory

Kimi's native model catalog is produced by a particular Kimi host after that host has loaded one provider target's endpoint, credentials, and configuration. It is not a runtime-global fact.

Cradle currently has two different model-catalog paths:

1. `GET /chat/runtimes/:runtimeKind/models` calls `ChatRuntime.listModels`. Its `ListRuntimeModelsInput` contains only `workspacePath`, so it cannot identify a Kimi provider target. Kimi deliberately returns an empty catalog here rather than starting an arbitrary target or combining catalogs across credentials.
2. The provider catalog and `/providers/targets/:providerTargetId/models-cache` are already target-scoped. They are used by agent and Composer model selection, but they query the generic provider adapter directly and do not describe Kimi-native aliases or host-specific availability.

There is also a `RuntimeOwnedProviderTargets.listModelsForProviderTarget` contract, currently used by OpenCode. It is not the right Kimi hook as-is: OpenCode owns and synthesizes its external provider targets, while Kimi consumes ordinary Cradle provider targets that can also be used by other runtimes. Registering Kimi as their owner would change existing ownership semantics.

### Current effect

- Kimi session creation and resume are not blocked. Host acquisition is already scoped by `providerTargetId`, and its resource fingerprint includes provider configuration and a credential fingerprint.
- The selected model is still passed into Kimi session creation and remains visible through the model UI slot.
- Generic target-scoped model choices can still come from the existing provider catalog.
- What is missing is authoritative Kimi-native discovery before a session starts. Cradle cannot currently ask "which models does Kimi expose for this selected target?" through `ChatRuntime.listModels`.

### Proposed contract

Extend runtime model discovery with a target-aware request rather than making Kimi's catalog global:

1. Add `providerTargetId` to the HTTP request and resolve it server-side into the same `RuntimeProviderTargetProfile` shape used to start a session. Pass the resolved profile to the runtime; providers must not load target rows or secrets directly.
2. Keep the target optional only for runtimes whose catalog is genuinely runtime-global. Kimi should require it and return a typed target-required error when it is absent.
3. Key any catalog cache by `runtimeKind`, `providerTargetId`, workspace/host scope, and the host resource fingerprint. Credential rotation or provider-config changes must invalidate the cached inventory without persisting raw credentials.
4. In Composer, select the provider target first, then request the runtime-native catalog. Merge only explicit custom models from that same target; never union model lists from different targets.
5. Preserve provider-native model identifiers and aliases in the runtime catalog. Resolution from a display choice to Kimi's `provider/model` reference remains owned by the Kimi adapter.

Required tests are target isolation, credential/config rotation invalidation, reuse of an already-running target host, missing/disabled target behavior, and model aliases that do not match the generic provider catalog.

This is a discovery-contract change, not a Kimi transport rewrite. It should be implemented in the shared runtime model-catalog owner before Kimi exposes native discovery.

## Terminal transcript streaming

Kimi exposes terminal metadata and close operations, which Cradle supports through its background-terminal contract. It does not expose a typed terminal-output stream in the current Chat Runtime contract. Tool progress is streamed through the normal turn event mapper, but a standalone terminal transcript surface needs a new contract owner before it can be added.

## Step timing diagnostics

The Usage module now owns canonical cross-runtime P50/P95 time-to-first-token and total-run duration, derived from completed run snapshots. Kimi participates through the same runtime-neutral run events as other providers.

Kimi transcript steps additionally expose request-build, server-decode, stream-duration, and client-consume timing fields. Those detailed phases remain native transcript facts until Cradle defines a shared phase taxonomy; they should not be projected into misleading Kimi-only Usage metrics.

## Protocol capability status

| Native fact | Class | Notes |
|---|---|---|
| `turn.ended.interruptReason` | **Projected** | Emitted as `data-runtime-event` (`kimi.turn.ended`) and influences finishReason for max_steps/error/filtered/blocked. |
| OAuth usage `name` / `reset_at` / `window` | **Projected** | `kimi:usage` slot reads `/api/v1/oauth/usage` (legacy `label`/`reset_hint` still accepted). |
| `/api/v1/oauth/userinfo` | Follow up | Can enrich account identity later; not required for usage slot. |
| `secondary_model` config | Follow up | Needs product meaning vs draft/effort models before a settings contract. |
| `/api/v1/search`, `/api/v1/workspace/fs:search` | Follow up | Needs a shared runtime reference/search kit (also noted in OpenCode GAP). |
| workspace `trust` / `untrust` | Leave native / Follow up | Ownership clash with Cradle workspace trust; do not dual-write. |
| `/api/v1/fs:mkdir` | Leave native | Writes stay on agent tools or Cradle workspace FS. |
| Payload `agentId` on live turn/tool/status events | **Projected** | Non-main output is isolated in per-agent mappers and published through provider-thread events. |
| `event.config.warning` / failed `event.model_catalog.changed` entries | **Projected** | Warning and failure facts enter the runtime warning stream; neutral changes do not. |
| Turn prompt attachments | **Projected** | Text, native skills, image/video base64 and URLs, local image/video paths, and local files are submitted through typed prompt content. Unsupported remote non-media files fail explicitly instead of being dropped. |
| `mcp.server.status` | **Projected** | Failed and needs-auth server states enter runtime warnings for the owning agent/session. Healthy status remains provider-native noise. |
| `event.config.changed` / successful catalog refresh | Leave native | Cradle has no actionable turn-level meaning for neutral host configuration refreshes. |
| `tower_mode` | Protocol only | The field exists, but Cradle has no captured trace that establishes its lifecycle semantics. It is not mapped to swarm/crew heuristically. |
| `event.session.archived` | Protocol only | The event carries a workspace id but no unambiguous session id. Provider-thread listing still reads archive status; live invalidation would be unsafe. |
| MCP server CRUD/OAuth management | Leave native | Kimi owns its registry and OAuth lifecycle. Cradle displays status without copying or dual-writing that registry. |
