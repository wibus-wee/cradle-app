# opencode

opencode Chat Runtime adapter.

This package owns opencode-native server lifecycle, provider config projection, prompt input projection, and opencode message-part to AI SDK chunk mapping. Cradle Chat Runtime owns runtime selection, durable binding, queues, sessions, and persistence.

The adapter always launches an opencode SDK server through `createOpencode`; it does not support client-only mode. Cradle provider targets are projected into opencode-native `config.provider[...]` entries and `config.model` values shaped as `providerID/modelID`. Native opencode details stay under this package instead of expanding the generic Provider API.

## Files

- `metadata.ts`: runtime identity and static capability metadata.
- `config.ts`: Cradle provider target to opencode `Config` projection.
- `runtime-context.ts`: opencode SDK server host resource acquisition.
- `input-projector.ts`: Chat Runtime message input to opencode prompt parts.
- `event-to-chunk-mapper.ts`: opencode prompt result parts to AI SDK `UIMessageChunk` events.
- `tools/`: Cradle-owned stable tool envelope projection for opencode tool parts.
- `provider.ts`: `ChatRuntime` facade for session start/resume, prompt turns, and cancellation.
