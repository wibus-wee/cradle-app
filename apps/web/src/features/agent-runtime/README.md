<!-- Once this directory changes, update this README.md -->

# Features/Agent-Runtime

Renderer data hooks for Agent Runtime provider targets, manual provider profiles, Agent identities, and provider-owned model inventory.
This feature exposes provider-target query ownership plus legacy manual profile mutations and Agent entity CRUD to launchers and settings.
Provider execution and credentials remain in the Electron main process.
Model visibility semantics are owned here: missing or empty `enabledModels` means all provider models are visible, the sentinel disables all models, and a non-empty list is an explicit allow-list.
Session title generation is Chat settings owned. Agent runtime provider config only carries provider connection, default model, and visible model inventory state.
Runtime catalog reads are exposed here as renderer data hooks, but runtime lifecycle and compatibility semantics remain server-owned by Chat Runtime.

## Model Query Lifecycle

| Owner | Responsibility |
| --- | --- |
| React Query | Shares target inventory across selectors and session bindings; deduplicates and cancels reads and live refreshes in one query lifecycle. Local targets share data across workspaces; remote nodes and runtime-owned targets retain their scope. |
| Provider Catalog server | Owns durable inventory freshness and failure cooldown. A fresh empty catalog is a valid result. |
| Provider Target settings | Supplies current visibility on each inventory read, independently of potentially older target-list metadata. |

Frontend inventory stays fresh for 60 seconds. Mount, reconnect, and picker requests revalidate stale data; settings mutations invalidate model queries immediately, including inactive queries that reload on their next mount. These are event-driven reads, without polling or focus-triggered requests.
Cached models stay visible while a cancellable live refresh checks missing or stale server inventory. Automatic refresh failures retain cached data; explicit refresh bypasses cooldown and reports failures through the query observer. Empty inventories remain loading until their live request settles.

## Files

- **agent-avatar.tsx**: Agent Runtime-owned compact avatar adapter that renders persisted Agent avatar URLs or DiceBear metadata for Kanban and other feature surfaces.
- **avatar-url.ts**: Agent identity DiceBear avatar URL builder shared by settings and feature surfaces.
- **model-visibility.ts**: Shared helpers for interpreting provider model visibility config and filtering model descriptors
- **model-visibility.test.ts**: Unit coverage for default-all, all-disabled, and explicit allow-list model visibility semantics
- **use-agent-profiles.ts**: `useAgentProfiles` hook — legacy manual provider mutation adapter for settings surfaces that still edit manual provider records, invalidating agent, provider-target, profile, and model queries when manual config changes
- **use-agents.ts**: `useAgents` hook — CRUD for Agent identity entities, shared agents query key export, explicit local Claude/Codex import mutation, and query success for settings readiness
- **use-agent-models.ts**: Model inventory hooks implementing the lifecycle above for provider targets, plus cached reads for legacy manual profiles.
- **use-provider-targets.ts**: `useProviderTargets` hook — reads unified manual and external provider targets for runtime selection surfaces via generated React Query options
- **use-runtime-catalog.ts**: `useRuntimeCatalog` hook — reads `/chat/runtimes` as the server-owned Runtime Descriptor catalog for Chat/Jarvis runtime selector metadata. Hidden kinds (see `ui-availability.ts`) are filtered by default; pass `{ includeHidden: true }` (Runtimes settings page) to list every runtime.
- **ui-availability.ts**: Runtime kinds hidden from runtime pickers (`standard`; `acp-chat` is visible and marked experimental).
- **runtime-compatibility.ts**: renderer-side runtime-kind to provider-kind compatibility helper used by composer filtering; relies on server runtime catalog metadata.
