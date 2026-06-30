# provider-contracts

跨 provider 模块的共享合约命名空间。

本模块拥有 provider/runtime taxonomy、provider config parser、model descriptor schema，以及 runtime/provider compatibility 规则。Provider catalog、provider targets、profiles、sessions、chat runtime 和 runtime providers 只能读取这里的共享合约，避免业务模块之间为了复用类型和配置 parser 产生环形依赖。
Session title generation preferences are owned by the Preferences/Chat settings namespace, not provider config.

## Files

- `types.ts`: Shared provider kind, runtime kind, provider request, model capabilities, and model descriptor TypeScript contracts.
- `model.ts`: TypeBox schemas for provider taxonomy and model descriptor HTTP contracts.
- `provider-base.ts`: Zod provider config schemas, trusted config readers, API key resolution, and base URL normalization.
- `runtime-compatibility.ts`: Runtime/provider compatibility matrix and lookup helpers.
