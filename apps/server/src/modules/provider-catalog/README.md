# provider-catalog

Provider live catalog HTTP API 与模型列表缓存。

本模块拥有 `/providers` route surface、provider-specific model listing、catalog cache、catalog audit writes，以及 provider list 结果的 capability defaults projection。OpenAI-compatible provider 的 live model discovery 走 provider base URL 下的 OpenAI-compatible `/v1/models` endpoint；本模块不再从 OpenAI-compatible model id 推断 reasoning effort，只保留协议或 registry 显式声明的 `reasoningEfforts`。Universal provider 的 live model discovery 固定走 OpenAI-compatible endpoint，并保留 `universal` descriptor ownership；Anthropic endpoint 只用于 Anthropic provider 自己的 model listing。Registry enrichment 仍由 `model-registry` 拥有，本模块只读取其 mapping/enrichment API。

## Four-layer contract (Plan 035 M1)

This module owns **Inventory** (layer 1):
- `collectProviderModelInventory(input)` fetches raw upstream models WITHOUT enrichment. This is
  the correct payload to write to `provider_target_model_cache`.
- `listModels(input)` = collectProviderModelInventory → enrichModelsFromRegistryMappings → projectProviderModelListCapabilities.
- `model-cache.ts`:
  - `setCachedModelsForTarget` strips all registry-enrichment-derived fields (registryMatch,
    registryModelId, cost, family, knowledgeCutoff, releaseDate) before persisting.
  - `getCachedModelsForTarget` is **async**: loads inventory from DB, applies current
    `enrichModelsFromRegistryMappings`, then `projectProviderModelListCapabilities`. Mapping changes
    take effect on the next read without a cache invalidation.
  - Failed upstream refreshes use a two-minute in-process negative-cache cooldown. During that
    window automatic UI refreshes retain a warm inventory (or return no models on a cold cache)
    instead of repeatedly probing the provider; an explicit refresh still bypasses it.

## Files

- `index.ts`: `/providers` HTTP routes and generated CLI metadata for provider model list/cache/search/lookup.
- `model.ts`: Route-local TypeBox schemas for provider catalog requests and responses.
- `service.ts`: Provider target override resolution, `collectProviderModelInventory` (raw upstream), `listModels` (full pipeline), custom model/default model fallback, and audit writes.
- `catalog.ts`: Provider-specific metadata implementations for OpenAI-compatible, Anthropic, and Universal model APIs.
- `model-cache.ts`: Inventory-only cache persistence; async read with re-enrichment.
- `model-capabilities.ts`: Provider-owned default modality and reasoning effort capability projection for live and cached model descriptors. Declared `reasoningEfforts` (including `[]` from registry) is preserved; Claude Agent effort heuristics only apply when the list is undeclared.
- `model-capabilities.test.ts`: Focused coverage for default capability projection.
