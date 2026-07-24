# Provider Runtime Module

Provider Runtime owns the boundary between Cradle conversation lifecycle and provider-native runtime handles.

## Ownership

Provider Runtime is the owner for runtime request routing:

- `service.ts` resolves a scoped runtime request to one of three sources: `live-side`, `durable-binding`, or `new-session`. Mutating turn-style requests may create a new provider session; read-only runtime queries use the existing-only resolver so they can read live side handles or durable bindings without accidentally starting a provider thread.
- `directory.ts` owns durable provider runtime bindings. It currently uses the existing `backend_session_bindings` table as the physical store, but the module-level contract is `ProviderRuntimeDirectory`. Directory rows are only valid when they contain a resumable provider session id.
- `side-conversation-registry.ts` owns live-only side conversation handles. These records are process memory state and intentionally do not become resumable provider bindings.
- `host-manager.ts` owns provider-neutral host lease accounting and live resource lifetime. It tracks host identity, ref count, pinned lease count, TTL refresh, release, idle reaping, and resource disposal. Hosts may explicitly retain their resource after the final lease until its TTL expires, allowing a later request to reuse a warm host; other hosts are disposed immediately. Provider adapters still own native protocol semantics, but host resources such as app-server clients are acquired and released through this manager.

Chat Runtime owns Cradle messages, queueing, run lifecycle, transcript persistence, and session rows. It may read durable provider bindings to link run rows or resolve session-scoped provider capabilities, but it must not insert, update, or delete `backend_session_bindings`. Provider adapters own native protocols such as Codex app-server, Claude Agent SDK, ACP, and OpenAI-compatible calls. Provider Runtime sits between them and decides which provider runtime handle should be used for a scoped request.

## Durable And Ephemeral Split

Durable chat sessions use `ProviderRuntimeDirectory`:

- A session can resume a provider thread after a host/client restart when the provider adapter returns a resumable `providerSessionId` and `providerStateSnapshot`.
- Directory records may store provider target, runtime kind, provider session id, provider state snapshot, and requested model.
- Runtime sessions without a resumable provider session id are not directory entries. They may still produce Cradle runs and transcripts, but their per-request model choice or provider snapshot must not be stored as a durable provider binding.

Ephemeral side conversations use `SideConversationRegistry`:

- Side conversations are registered as live-only records only after their owner has pre-reserved a pinned side host lease.
- Side messages use the registered runtime session while the process is alive.
- Side records hold pinned `ProviderRuntimeLease` instances and refresh them on use.
- TTL expiry or explicit release releases the pinned host lease and lets `ProviderRuntimeHostManager` dispose the live host resource when no leases remain.
- The registry does not persist provider session id or provider state as durable binding data.

## Files

- `service.ts`: provider runtime request resolution and binding persistence policy.
- `directory.ts`: durable provider runtime binding directory backed by the existing DB table.
- `host-manager.ts`: provider-neutral `ProviderRuntimeHostManager` and `ProviderRuntimeLease` implementation.
- `side-conversation-registry.ts`: process-local live side conversation registry with pinned lease TTL refresh/release helpers.
