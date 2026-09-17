# model-registry

全局模型 registry 映射模块，负责维护 Cradle-owned model ID 到 registry model 的映射。

这个模块拥有所有 target 共享的单一 enrichment resolve path（见 Plan 035 M1）。Provider target 可以声明 custom model ID，但不拥有 capabilities；custom model 与上游模型列表都会通过 `resolveModelEnrichment` 和只读 models.dev 数据完成能力补全。

## Four-layer contract (Plan 035)

This module owns **Enrichment** (layer 2):
- `resolveModelEnrichment(modelId, data, mappings)` is the single resolver used by list projection,
  lookup, pricing, context-window, and all future consumers.
- Resolution order: global mapping (model or registryModelId exact→fuzzy) → models.dev fuzzy.
- Registry caps **win over** stale inventory caps on merge.

models.dev publishes provider-agnostic model facts in `models.json`, while serving-specific controls,
limits, and prices remain in provider records in `api.json`. Cradle consumes the latter because an
unknown OpenAI-compatible gateway exposes only a serving model ID and selectable reasoning controls
are provider-specific. Duplicate records already inherit models.dev base-model facts, so aggregation
reconstructs the optimistic model projection without guessing an upstream provider namespace.

## Files

- `index.ts`: HTTP routes for listing, upserting, and deleting global model registry mappings.
- `model.ts`: TypeBox schemas for mapping route params, payloads, and responses.
- `service.ts`: Drizzle-backed global mapping persistence. `upsertMapping` uses fuzzy lookup
  (`lookupModelRaw`) so alias rows store usable JSON when possible. `enrichModels(models)` is
  the public enrichment operation for other modules — it reads current mappings internally so
  callers never pair a resolver with `listMappingEntries()` themselves.
- `model-info-registry.ts`: Read-only models.dev cache (SWR: 1h soft / 24h hard TTL, force-refresh
  on server boot), `resolveModelEnrichment`, `enrichModelsWithRegistryData`,
  `enrichModelsFromRegistryMappings`, `getCachedModelsDevCost` (DB-backed, not mem-only),
  fuzzy-enabled `lookupContextWindow` and `lookupModel`.
  - Aggregates duplicate model IDs across models.dev provider records before every exact/fuzzy lookup:
    capability booleans use optimistic OR, effort/modalities use stable unions, token limits use maxima,
    descriptive strings use deterministic consensus, and cost uses one most-complete provider record.
  - Projects `reasoning` + aggregated `reasoning_options` into `capabilities.reasoning` /
    `reasoningEfforts` (`effort.values` only; empty/toggle/budget-only → `[]`).
  - Upstream inventory `reasoningEfforts` win over registry projection on merge.
- `model-info-aggregation.ts`: Pure duplicate-record aggregation policy. It reconstructs the most
  complete provider-agnostic projection available for model IDs exposed by unknown gateways without
  combining scalar price fields from different providers.
