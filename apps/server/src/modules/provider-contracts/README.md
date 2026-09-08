# provider-contracts

跨 provider 模块的共享合约命名空间。

本模块拥有 provider/runtime taxonomy、provider config parser、model descriptor schema，以及 runtime/provider compatibility 规则。Provider catalog、provider targets、profiles、sessions、chat runtime 和 runtime providers 只能读取这里的共享合约，避免业务模块之间为了复用类型和配置 parser 产生环形依赖。
Session title generation preferences are owned by the Preferences/Chat settings namespace, not provider config.

| Contract | Owner | Consumers |
| --- | --- | --- |
| Provider/runtime taxonomy and models | [`types.ts`](./types.ts), [`model.ts`](./model.ts) | Runtime, catalog and HTTP routes |
| Provider configuration and credentials | [`provider-base.ts`](./provider-base.ts) | Provider targets and runtime adapters |
| Codex native overrides | [`codex-native-config.ts`](./codex-native-config.ts), [`codex-config-schema/`](./codex-config-schema/) | Provider settings validation and Codex process projection |
| Runtime compatibility | [`runtime-compatibility.ts`](./runtime-compatibility.ts) | Provider selection and routing |

Codex native overrides live under `connectionConfigJson.codex`. The bundled upstream schema validates names and values; Cradle removes fields whose ownership belongs to its model, authentication, permission, MCP, invocation, and runtime-storage controls. Missing values inherit native defaults; explicit `false` is preserved. Null is rejected because TOML cannot represent it. Schema validation does not guarantee that a CLI/TUI-only or experimental option has an observable effect in Cradle.

`pnpm --filter @cradle/server sync:codex-config-schema` downloads the schema from the release matching the generated app-server protocol manifest. Its manifest records version, release tag, source and SHA-256 without timestamps. The SDK update command runs this sync after protocol generation, so configuration additions, removals and type changes are reviewable in the same PR. The editable API schema removes managed properties; the manifest hash identifies the unmodified upstream snapshot.
