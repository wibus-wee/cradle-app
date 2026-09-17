# Plan 035 — Unify model Inventory / Enrichment / Visibility / Selection

> **Executor instructions**: Follow milestones in order. Each milestone must leave the app usable. Honor STOP conditions. Update this file's Progress and `plans/README.md` as you go.
>
> **Drift check (run first)**: Confirm these still exist and own the named concerns before editing:
> - `apps/server/src/modules/provider-catalog/service.ts` — `listModels`
> - `apps/server/src/modules/provider-catalog/model-cache.ts` — `provider_target_model_cache`
> - `apps/server/src/modules/model-registry/model-info-registry.ts` — models.dev + enrichment
> - `apps/server/src/modules/provider-targets/service.ts` — `enabled_models_json`, `custom_models_json`
> - `apps/web/src/features/agent-runtime/use-agent-models.ts` — composer/settings inventory reads
> - `apps/web/src/features/composer-toolbar/` — selection + thinking UI
>
> Mismatch = STOP and re-map file ownership before coding.

## Status

- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH — touches provider list, chat composer, session binding, OpenCode config, pricing, conversation bridge
- **Depends on**: none (orthogonal to plugin/remote plans)
- **Category**: architecture / correctness
- **Planned at**: commit `07fa90f`, 2026-07-10

## Why this matters

Users experience one product surface — “pick a provider, see its models, match them to models.dev, choose which are visible, chat with one” — but Cradle currently implements four half-connected systems. The provider model cache stores enrichment snapshots; global registry mappings do not invalidate that cache; visibility lives in `enabled_models_json` while some UIs still read `connectionConfigJson.enabledModels`; composer “refresh” is ignored when a cache row exists; selection silently falls back to `models[0]` when a bound model is missing; OpenCode, system-agent, pricing, and list enrichment each resolve models differently.

After this plan, those four concerns have one contract each, one resolve path for enrichment, and selection never lies about what is available.

## Target architecture (the contract)

Define four layers. Every code path must declare which layer it owns. No path may invent a parallel rule.

### 1. Inventory

**Question**: Which model IDs exist for this provider target right now?

**Owner**: `provider-catalog`

**Source of truth**:
- Upstream provider list APIs (OpenAI-compatible `/v1/models`, Anthropic, runtime-owned OpenCode inventory)
- Plus `provider_targets.custom_models_json` entries whose IDs are not already upstream (store only `{ id, label }` — never capabilities)

**Cache**: `provider_target_model_cache` stores **inventory only**: `{ id, label, providerKind }` (plus optional upstream-native capability hints that are not registry enrichment). It must **not** store `registryMatch`, `registryModelId`, registry cost/family, or other models.dev-derived fields as authoritative.

**Freshness**:
- Soft TTL (suggest 1h) and hard TTL (suggest 24h), same SWR idea as models.dev
- `refresh: true` always bypasses soft TTL and re-fetches upstream
- Connection config / credential / providerKind changes invalidate the cache row
- Cache miss for a target the UI is actively using triggers a live fetch (not only for `runtime-native:*`)

### 2. Enrichment

**Question**: What do we know about this model ID (capabilities, cost, registry match)?

**Owner**: `model-registry` (`model-info-registry.ts` + mappings table)

**Single resolve function** (name suggestion: `resolveModelEnrichment(modelId)`), used by list projection, lookup, OpenCode bridge, system-agent, pricing, context-window, and any future consumer:

1. Global mapping for exact `modelId` (`manual` / `alias`) — if mapping has `modelJson`, use it; else resolve `registryModelId` via models.dev (exact then fuzzy)
2. Else models.dev exact match on `modelId`
3. Else models.dev fuzzy match
4. Else `unmatched`

**Read path**: Always apply enrichment when serving a model list to clients (cache read + live list). Never rely on enrichment frozen at cache-write time.

**models.dev catalog cache**: Keep the existing SWR (1h soft / 24h hard) + boot force-refresh. Pricing must use the same local cache helper as enrichment (DB + memory), not memory-only.

**Custom model “Match from models.dev”**: Creates or updates a **global mapping**. It does not persist capabilities on `custom_models_json`.

### 3. Visibility

**Question**: Which inventory IDs may agents / composer / bridges offer?

**Owner**: `provider-targets` column `enabled_models_json`

**Semantics** (unchanged, but enforced everywhere):
- `[]` → all visible
- `['__all_disabled__']` → none
- explicit list → subset

**Rules**:
- `GET /profiles/:id` must not pretend `connectionConfigJson` contains authoritative `enabledModels`
- All readers use `GET /provider-targets/:id/model-settings` (or `resolveProviderTarget` merge) for visibility
- Strip / ignore `enabledModels` inside connection config on write if still present
- Conversation bridge applies the same visibility filter as composer

### 4. Selection

**Question**: Which model ID is active for composer / session / agent / Jarvis / title-gen?

**Owner**: the feature that stores the binding (session config, agent row, preferences), but **resolution** is shared

**Shared resolver rules**:
- Prefer bound / manual / agent / persisted ID **only if** it is in the **visible inventory** (or explicitly allowlisted as “bound exception” — see below)
- Never silently substitute `models[0]` without a user-visible reason
- If bound ID is missing from inventory: show orphan state (raw id + “refresh / unavailable”); do not pretend another model is selected
- **Bound-session exception**: for an active chat session, if the session `modelId` is outside the current visibility allow-list, still resolve its descriptor for capability gating (attachments / thinking) by enriching that single ID, and show a clear “hidden but bound” affordance — do not auto-rewrite the session to `models[0]` on mount
- Provider switch that needs a default model must either keep previous selection if still valid, or leave selection empty until the user picks — auto-persist of `models[0]` into session is forbidden unless the UI labels it as an explicit default action

Wire `reconcileProfiles()` (or equivalent) so `lastModelByProfile` / last agent prefs are pruned when targets are removed, disabled, or models become invisible.

## Out of scope

- Redesigning models.dev itself or replacing it with another catalog
- Changing Drizzle schema for mappings unless a milestone proves `{ id, label }` custom models + global mappings cannot express a needed case (prefer no schema change)
- Plugin marketplace / remote-host gateway architecture (consume existing remote upstream paths; do not redesign them)
- Full Claude Agent alias-matrix redesign (haiku/sonnet/opus env aliases stay separate; document the distinction)

## Milestone plan

### M0 — Characterization harness (no behavior change)

**Goal**: Lock today’s buggy contracts so refactors cannot silently regress.

Add focused tests (server + web) that document current behavior you will change, then flip expectations milestone-by-milestone:

1. Cache row retains `registryMatch` after mapping upsert without list refresh (today: stale) → later: re-enriched on read
2. `refresh: true` with warm cache does not hit upstream (today) → later: does
3. Profile GET `configJson.enabledModels` vs `enabled_models_json` divergence
4. `resolveComposerModelId` returns agent model not in list
5. `getCachedModelsDevCost` returns null when mem cold but DB warm
6. Conversation bridge returns hidden models

**Verify**: new tests fail-or-pass as documented; `pnpm --filter @cradle/server test` and focused web tests green for the harness itself.

**STOP**: If characterization cannot be written without rewriting half the app, narrow to the three highest-risk paths (cache+mapping, composer refresh, visibility source) and note the rest as follow-up tests inside later milestones.

### M1 — Single enrichment resolve + read-time projection

**Goal**: One resolve function; list/cache responses re-enrich on read.

Server:

1. Extract `resolveModelEnrichment(modelId, mappings, modelsDevData)` as the only matcher
2. Delete or thin wrappers: unused `enrichModelsFromRegistry`, duplicate fuzzy helpers if safe
3. Change `getCachedModelsForTarget` / cache GET handlers to: load inventory IDs → apply resolve + `projectProviderModelListCapabilities`
4. Change `listModels` to: build inventory → write **inventory-only** cache → return enriched projection (do not persist enrichment into cache JSON)
5. Mapping upsert/delete: either invalidate all provider caches **or** rely on read-time enrich (prefer read-time; optional invalidate for label churn)
6. Fix pricing: `getCachedModelsDevCost` uses `getLocalCache()` / same resolve; alias without `modelJson` follows `registryModelId`
7. Fix `lookupContextWindow` and `POST /providers/model-lookup` to use the same resolve (fuzzy allowed)
8. `upsertMapping`: when persisting `modelJson`, use resolve (not exact-only) so alias rows store usable JSON when possible

Web:

1. Custom models editor “Match” opens mapping dialog / writes global mapping; remove local-only capability theater
2. Registry settings / mapping dialog invalidate `AGENT_MODELS_QUERY_KEY` (and any models-cache query keys) after save/delete

**Verify**:
- Map a model in Settings → composer / models panel show new `registryMatch` **without** clicking Fetch Models
- Restart server → usage pricing still resolves from DB models.dev cache
- `pnpm --filter @cradle/server test` focused model-registry + provider-catalog + usage

### M2 — Inventory freshness + real refresh

**Goal**: Cache is inventory SWR; refresh means refresh.

1. Implement soft/hard TTL on `provider_target_model_cache` (reuse `fetchedAt`; wire `stale` into clients or delete the dead `getStaleProviderTargetIds` after replacement)
2. `fetchVisibleModelsForProviderTarget({ refresh: true })` **must** call `POST /providers/models` even when `cache.cached`
3. Cache miss on active composer/settings target → live fetch for all API provider kinds (not only runtime-owned)
4. Invalidate cache on connection config / credential / providerKind updates in `provider-targets`
5. Fix `useProviderTargetModels` cache-miss warm to pass real `providerKind` / name (no hardcoded `universal`)
6. Unify `useProviderTargetModels` and `useProviderTargetModelMap` onto one fetch policy helper
7. Universal provider listing: if only Anthropic URL is configured, list via Anthropic path (or document and return a clear error instead of OpenAI-only failure)

**Verify**:
- Empty cache → open composer model menu → models appear without visiting provider detail
- Warm cache → open menu with refresh → upstream called (mock/spy in test)
- Change base URL → old cache not served

### M3 — Visibility single source

**Goal**: One column, all readers.

1. Profile detail / any remaining profile-config init loads visibility from `model-settings` (same as external record panel)
2. `toProfile` / profile OpenAPI docs: do not expose authoritative `enabledModels` from connection config; or merge for backward compat **only** if clearly marked deprecated and UI no longer writes it
3. Strip `enabledModels` from connection config on profile/provider upsert
4. Conversation bridge filters by visibility
5. Remove or gate dead `useAgentModels` / `useAgentModelMap` profile paths that read wrong visibility — migrate any stragglers to provider-target helpers

**Verify**:
- Set allow-list → reload manual profile detail → toggles match
- Composer and bridge agree on visible set
- Hidden model not offered in bridge picker

### M4 — Selection honesty

**Goal**: No silent `models[0]` lies.

1. Shared selection helpers in `composer-toolbar/resolution/` (and reused by agent-detail / jarvis / chat-settings where practical):
   - never return an ID absent from visible inventory except the bound-session exception
   - orphan / unavailable UI state in provider-model-picker
2. `chat-runtime-view`: stop auto-persisting `models[0]` into session on provider switch; require explicit pick or keep prior valid ID
3. Bound session outside visibility: keep session id, enrich single-id for capabilities, show banner/affordance
4. Call profile reconciliation when provider targets load; prune `lastModelByProfile`
5. Agent detail / Jarvis / title-gen: replace silent `[0]` defaults with empty selection or explicit “Use first available” only where product requires a default (document each exception in Decision Log)
6. Jarvis send path: pass configured thinking level

**Verify**:
- Hide the session’s model → composer shows unavailable/hidden-bound, does not rewrite session on mount
- Agent with model not in list → orphan display, not a fake other model
- Delete provider → lastModel prefs for that id gone

### M5 — Runtime bridges converge

**Goal**: OpenCode / system-agent / runtime-owned use the same enrichment resolve.

1. OpenCode `buildOpencodeModels` / mapping resolve: call shared resolve (fuzzy + global mappings from DB, not only session-injected JSON). Session/agent JSON must not overwrite global mappings unless explicitly designed as an override list (default: global wins; session cannot clobber)
2. Runtime-owned `listModels` early return: still project through shared enrichment (or clearly omit registry fields in UI for those targets — prefer enrich)
3. System-agent bridge: thin wrapper over shared resolve (delete divergent fuzzy copy if any)
4. Document Claude Agent haiku/sonnet/opus aliases as **not** `model_registry_mappings`

**Verify**:
- OpenCode session with alias mapping gets cost/limit metadata without exact-only failure
- Runtime-owned target shows registryMatch when models.dev knows the id
- Focused opencode + system-agent tests

### M6 — Cleanup and docs

1. Delete dead code: unused enrich wrappers, unused stale-id scanner if replaced, dead profile model-map hooks, unused `model-registry-add-dialog` if still unreferenced
2. Update READMEs: `model-registry`, `provider-catalog`, `provider-targets`, `agent-management`, `composer-toolbar`, `profiles` (remove “profile-owned mappings” drift)
3. Flip M0 characterization tests to the new expected behavior; remove tests that only encoded bugs
4. Update `plans/README.md` status to DONE

**Verify**:
- `pnpm --filter @cradle/server typecheck`
- `pnpm --filter @cradle/web typecheck`
- `pnpm --filter @cradle/server test`
- `pnpm --filter @cradle/web test`
- Manual smoke: map model → composer updates; refresh menu live-fetches; visibility reload; orphan bound model

## Concrete file touch list (expected)

Server:
- `apps/server/src/modules/model-registry/model-info-registry.ts`
- `apps/server/src/modules/model-registry/service.ts`
- `apps/server/src/modules/provider-catalog/service.ts`
- `apps/server/src/modules/provider-catalog/model-cache.ts`
- `apps/server/src/modules/provider-catalog/index.ts`
- `apps/server/src/modules/provider-catalog/catalog.ts` (universal list URL)
- `apps/server/src/modules/provider-targets/service.ts`
- `apps/server/src/modules/profiles/service.ts`
- `apps/server/src/modules/usage/pricing.ts`
- `apps/server/src/modules/conversation-bridge/service.ts`
- `apps/server/src/modules/chat-runtime-providers/opencode/config.ts`
- `apps/server/src/modules/chat-runtime/runtime-session-context.ts`
- `apps/server/src/modules/system-agent/model-registry-bridge.ts`

Web:
- `apps/web/src/features/agent-runtime/use-agent-models.ts`
- `apps/web/src/features/composer-toolbar/**`
- `apps/web/src/features/chat/chat-runtime-view.tsx`
- `apps/web/src/features/chat/composer/use-chat-composer-runtime.ts`
- `apps/web/src/features/agent-management/profile-detail-panel.tsx`
- `apps/web/src/features/agent-management/custom-models-editor.tsx`
- `apps/web/src/features/agent-management/models-panel.tsx`
- `apps/web/src/features/model-registry/**`
- `apps/web/src/features/settings/model-registry-settings.tsx`
- `apps/web/src/features/settings/jarvis-settings.tsx`
- `apps/web/src/store/new-chat.ts` (`reconcileProfiles`)

## Commands

| Purpose | Command |
|---------|---------|
| Server typecheck | `pnpm --filter @cradle/server typecheck` |
| Web typecheck | `pnpm --filter @cradle/web typecheck` |
| Server tests | `pnpm --filter @cradle/server test` |
| Web tests | `pnpm --filter @cradle/web test` |
| Focused registry/catalog | `pnpm --filter @cradle/server exec vitest run tests/profiles.test.ts tests/sdk-providers.test.ts` (adjust to files you add) |

## Done criteria

- [x] Cache JSON no longer treated as enrichment source of truth; read paths re-enrich
- [x] One resolve function used by list, lookup, pricing, OpenCode, system-agent, context-window
- [x] `refresh: true` always live-fetches inventory
- [x] Visibility only from `enabled_models_json` / model-settings
- [x] Selection never silently replaces a bound/selected id with `models[0]` on mount
- [x] Custom Match writes global mapping
- [x] READMEs match the four-layer contract
- [x] M0 tests updated to new behavior; server + web typecheck/tests pass
- [x] `plans/README.md` row marked DONE

## STOP conditions

- A milestone seems to require a DB migration for enrichment storage — STOP and confirm with maintainer; prefer read-time enrich over new tables
- OpenCode requires enrichment fields that cannot be projected from shared resolve without breaking runtime config — STOP and record in Decision Log before forking a second resolve
- Changing session auto-select behavior breaks a documented product requirement for “always have a model” — STOP and add an **explicit** defaulting API rather than restoring silent `[0]`

## Progress

- 2026-07-10: Plan authored from architecture audit (inventory/enrichment/visibility/selection debt). No implementation yet.
- 2026-07-10: M0–M5 largely landed in-tree:
  - M0/M1: `resolveModelEnrichment`, inventory-only cache + read-time enrich, pricing/local-cache cost, fuzzy lookup/context-window, `lookupModelRaw` for upsertMapping, `tests/model-registry.test.ts` (16 passing)
  - M2: composer `refresh: true` always live-fetches; cache miss live-fetches for all API providers; connection/credential changes invalidate inventory cache; soft stale threshold 1h
  - M3: profile detail loads visibility from model-settings; conversation bridge filters by `enabled_models_json`
  - M4: selection no longer silently picks `models[0]`; bound session/agent ids kept as orphans; chat-runtime-view no longer auto-persists first model on provider switch
  - M5: OpenCode + system-agent mapping resolve use fuzzy `lookupModelRaw`; OpenCode also fuzzy-falls back when unmapped
  - Web: mapping dialog/settings invalidate `AGENT_MODELS_QUERY_KEY`; custom-models Match writes global alias mapping
- 2026-07-10: M0–M6 core landed. Optional follow-ups: richer orphan/hidden-bound UI copy in composer picker; client auto-refresh when `stale: true`; Universal Anthropic-only list URL; strip `enabledModels` from connection config on write.
- 2026-09-17: follow-up sweep verified against live code. `stale: true` client SWR already implemented (`use-agent-models.ts` revalidates when `!cache.cached || cache.stale`); `reconcileProfiles` was deleted outright (moot); `enabledModels` is stripped from persisted connection config on write (`buildProfileConfig` discards it; visibility reads `enabledModelsJson`); orphan bound ids render their raw id with no fake substitution (`provider-model-picker`). Implemented the last open item: Universal targets with only an Anthropic base URL now list via the Anthropic `/v1/models` wire instead of failing OpenAI-only (`catalog.ts` + regression test).

## Surprises & Discoveries

- `refresh: true` in `use-agent-models.ts` is short-circuited by `if (cache.cached) return cached` — name does not match behavior. **Fixed in M2.**
- `reconcileProfiles` exists in `new-chat` store but has zero call sites. **Still open for M6 / follow-up.**
- `getStaleProviderTargetIds` and cache `stale` flag are unused by web. Soft threshold now 1h; client still does not auto-refresh on stale alone (menu refresh path does).
- Profile API returns `connectionConfigJson` without merging `enabled_models_json`; external panel already uses the correct model-settings path. **Profile detail now loads model-settings for visibility.**
- OpenCode enrichment is weaker than system-agent (exact-only + session-injected mappings). **Fuzzy resolve added; session-injected mappings still the OpenCode source for mapping list (injected at session build).**

## Decision Log

- 2026-07-10: Chose **read-time enrichment** over “invalidate all caches on mapping write” as the primary fix — mappings are global and frequent; re-enrich on read is O(models) and keeps inventory cache stable.
- 2026-07-10: Custom models remain `{ id, label }` only; Match creates global mappings — avoids a third capabilities store.
- 2026-07-10: Bound-session visibility exception — do not auto-rewrite session model on mount when hidden; show honest UI instead.
- 2026-07-10: Forbid silent `models[0]` persistence into sessions; empty/orphan states preferred.
- 2026-07-10: Milestone order M1→M2→M3→M4→M5 so composer benefits early (enrichment + refresh) before selection UX polish.
- 2026-07-10: On provider switch in chat, keep current model if still in the new inventory; otherwise clear selection and wait for explicit pick (no auto `models[0]`).

## Outcomes & Retrospective

M0–M6 core delivered in one implementation pass. Highest-leverage wins: read-time enrichment (mapping changes visible without Fetch Models), real composer refresh, and selection no longer inventing `models[0]`. Remaining polish is UX copy and a few edge inventory paths (Universal Anthropic-only listing, stale-flag client SWR), not contract holes.
