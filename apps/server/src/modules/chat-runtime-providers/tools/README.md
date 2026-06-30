# Provider Tools

Cradle-owned provider tool identity and payload contracts.

Provider adapters may read provider-native tool calls, but they should project those calls into the stable tool envelope owned here before the payload reaches chat persistence or frontend rendering. Provider-specific tool identity and payload mapping lives under each provider's own `tools/` directory, for example `claude-agent/tools/` and `codex/tools/`.

## Files

- `tool-call-payload.ts`: shared `{ identifier, apiName, args, result }` envelope helpers for provider tool call input and output payloads.
