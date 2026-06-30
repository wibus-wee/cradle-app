# provider-catalog

Provider live catalog HTTP API 与模型列表缓存。

本模块拥有 `/providers` route surface、provider-specific model listing、catalog cache、catalog audit writes，以及 provider list 结果的 capability defaults projection。Provider catalog 会把 live/cache model descriptor 投影为 provider-owned default modalities 与显式 `reasoningEfforts`，供 Web 只展示当前 provider/model 支持的 thinking effort。Universal provider 的 live model discovery 固定走 OpenAI-compatible endpoint，并保留 `universal` descriptor ownership；Anthropic endpoint 只用于 Anthropic provider 自己的 model listing。Registry enrichment 仍由 `model-registry` 拥有，本模块只读取其 mapping/enrichment API。

## Files

- `index.ts`: `/providers` HTTP routes and generated CLI metadata for provider model list/cache/search/lookup.
- `model.ts`: Route-local TypeBox schemas for provider catalog requests and responses.
- `service.ts`: Provider target override resolution, live model listing, custom model/default model fallback, registry enrichment, and audit writes.
- `catalog.ts`: Provider-specific metadata implementations for OpenAI-compatible, Anthropic, and Universal model APIs.
- `model-cache.ts`: Provider model cache persistence helpers for profile and provider-target catalog rows.
- `model-capabilities.ts`: Provider-owned default modality and reasoning effort capability projection for live and cached model descriptors.
- `model-capabilities.test.ts`: Focused coverage for default capability projection.
