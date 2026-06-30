# System Agent Runtime Provider

Owns the jar-core System Agent adapter for Chat Runtime. This provider projects Cradle text turns into jar-core message ingress commands, bridges jar-core assistant events back to AI SDK `UIMessageChunk` events, and resolves Cradle model-registry metadata into jar-core runtime model config.

System Agent runs from Cradle's server data directory, with `jar-sessions` for jar-core session state and `jarvis-workspace` for the runtime workspace. It reads Cradle provider targets, preferences, secrets, and model-registry data, but it does not own those namespaces.

## Files

- `provider.ts`: System Agent `ChatRuntime` facade; starts/resumes runtime sessions, builds jar-core commands, manages active cancellation, and records final usage/model state.
- `metadata.ts`: System Agent runtime kind, catalog metadata, and static capabilities.
- `types.ts`: System Agent provider-private thinking-level and jar-core event payload types.
- `runtime-context.ts`: Resolves jar-core session and workspace roots from Cradle server data-dir config.
- `input-projector.ts`: Projects Cradle turn input into the text-only jar-core prompt.
- `model-registry-bridge.ts`: Bridges Cradle provider kind/model-registry data into jar-core provider, API, thinking, and model metadata config.
- `event-to-chunk-mapper.ts`: Maps jar-core assistant message events into AI SDK `UIMessageChunk` events.
- `state-projector.ts`: Projects provider snapshot model state for started/resumed sessions.
