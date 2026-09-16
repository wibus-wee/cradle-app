# provider-catalog

Provider live catalog HTTP API 与模型列表缓存。

本模块拥有 `/providers` route surface、provider-specific model listing、catalog cache、catalog audit writes，以及 provider list 结果的 capability defaults projection。OpenAI-compatible provider 的 live model discovery 走 provider base URL 下的 OpenAI-compatible `/v1/models` endpoint；本模块不再从 OpenAI-compatible model id 推断 reasoning effort，只保留协议或 registry 显式声明的 `reasoningEfforts`。Universal provider 的 live model discovery 固定走 OpenAI-compatible endpoint，并保留 `universal` descriptor ownership；Anthropic endpoint 只用于 Anthropic provider 自己的 model listing。Registry enrichment 仍由 `model-registry` 拥有，本模块只读取其 mapping/enrichment API。

## Four-layer contract (Plan 035 M1)

ChatGPT-authenticated targets discover models through Codex `model/list`. That client receives the target's schema-validated native `codex` overrides alongside Cradle's managed endpoint projection, so catalog-related native settings apply to discovery as well as chat startup. [Provider Targets](../provider-targets/README.md) invalidates cached inventory when these overrides change.

This module owns **Inventory** (layer 1):
- `collectProviderModelInventory(input)` fetches raw upstream models WITHOUT enrichment. This is
  the correct payload to write to `provider_target_model_cache`.
- A successful upstream list prunes same-id entries from `custom_models_json` through the
  Provider Targets owner. Custom models therefore contain only IDs the provider did not report;
  failed list requests never delete user configuration.
- `listModels(input)` = collectProviderModelInventory → Model Registry `enrichModels` →
  projectProviderModelListCapabilities. It never touches the target cache.
- `target-model-query.ts`: `queryProviderTargetModels({ target, freshness, visibility })` is the
  single target-scoped query seam shared by the `/providers` routes and Conversation Bridge.
  - Freshness is explicit: `cached` never contacts upstream; `prefer-cache` serves a fresh cache
    and performs exactly one cooldown-governed fetch on cold/stale; `refresh` always fetches and
    bypasses the failed-refresh cooldown (explicit user refresh).
  - The pipeline resolves the target, collects inventory with custom/default fallback, persists
    inventory-only cache rows, asks Model Registry to enrich, projects provider capabilities,
    applies optional stored visibility, and returns models + freshness metadata.
  - `visibility: 'stored'` reads the target's persisted enabled-model list through Provider
    Targets' `readProviderTargetModelVisibility`; an all-disabled target short-circuits to an
    empty result without fetching.
- `model-cache.ts` owns only inventory persistence and freshness/failure state:
  - `setCachedModelsForTarget` strips all registry-enrichment-derived fields (registryMatch,
    registryModelId, cost, family, knowledgeCutoff, releaseDate) before persisting.
  - `readCachedModelInventory` returns the raw persisted inventory; enrichment and capability
    projection live in the query pipeline so mapping changes take effect on read without a
    cache invalidation.
  - Failed upstream refreshes use a two-minute in-process negative-cache cooldown. During that
    window `prefer-cache` retains a warm inventory (or returns an empty cooling-down result on a
    cold cache) instead of repeatedly probing the provider; an explicit refresh still bypasses it.

## Files

- `index.ts`: `/providers` HTTP routes and generated CLI metadata for provider model list/cache/search/lookup, plus the root-level `GET /provider-presets` preset catalog route.
- `model.ts`: Route-local TypeBox schemas for provider catalog requests and responses.
- `provider-preset-overlay.ts`: Curated overlay (base URLs, hostnames, default models) used for models.dev merge + endpoint suggest hints.
- `provider-registry.ts`: Provider setup contributions (`providerId` identity, authMethods, endpointProfiles). Gallery auth/endpoints project from here.
- `provider-presets.ts`: `collectProviderPresets()` = models.dev + overlay seeds, then contribution projection (`providerId`, `tier`, `authMethods`, `endpointProfiles`). It publishes connection metadata and explicit curated defaults only, never the full models.dev provider inventory.
- `provider-endpoint-registry.ts`: Hostname → endpoint template matching derived from the overlay; owns `matchProviderEndpoint` / suggest-style helpers. Must never write `providerId`.
- `service.ts`: Provider target override resolution, `collectProviderModelInventory` (raw upstream), `listModels` (non-cached full pipeline), custom model/default model fallback, and audit writes.
- `target-model-query.ts`: `queryProviderTargetModels` — the shared target-scoped query owning freshness policy, cache/fetch orchestration, enrichment + capability projection ordering, and stored visibility.
- `catalog.ts`: Provider-specific metadata implementations for OpenAI-compatible, Anthropic, and Universal model APIs.
- `model-cache.ts`: Inventory-only cache persistence and refresh-failure cooldown; no enrichment.
- `model-capabilities.ts`: Provider-owned default modality and reasoning effort capability projection for live and cached model descriptors. Declared `reasoningEfforts` (including `[]` from registry) is preserved; Claude Agent effort heuristics only apply when the list is undeclared.
- `model-capabilities.test.ts`: Focused coverage for default capability projection.
