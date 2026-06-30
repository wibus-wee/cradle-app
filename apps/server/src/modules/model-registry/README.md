# model-registry

全局模型 registry 映射模块，负责维护 Cradle-owned model ID 到 registry model 的映射。

这个模块拥有所有 target 共享的 enrichment 第一阶段。Provider target 可以声明 custom model ID，但不拥有 capabilities；custom model 与上游模型列表都会通过这里的全局 mappings 和只读 models.dev 数据完成能力补全。

## Files

- `index.ts`: HTTP routes for listing, upserting, and deleting global model registry mappings.
- `model.ts`: TypeBox schemas for mapping route params, payloads, and responses.
- `service.ts`: Drizzle-backed global mapping persistence plus enrichment projection helpers.
- `model-info-registry.ts`: Read-only models.dev cache, search, lookup, and registry enrichment helpers.
