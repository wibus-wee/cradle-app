# chat-runtime-providers

Concrete chat runtime provider implementations consumed by `chat-runtime`.

This module owns provider-specific runtime adapters only. Shared provider metadata, provider target ownership, secrets, sessions, queues, and persistence stay in their owning modules.
Provider adapters parse provider-native protocols, but Cradle-owned tool identity is owned by `tools/`. Tool calls emitted from providers should carry the stable `{ identifier, apiName, args, result }` envelope in their input/output payloads.
Runtime selection metadata is registered by `../chat-runtime/chat-runtime-provider-registry.ts`; provider directories own execution semantics, while Chat Runtime owns the catalog used by Chat, Jarvis, and plugin-registered runtimes.

Runtime provider directories use a shared domain package shape when they own a responsibility: `provider.ts` is the `ChatRuntime` facade, `metadata.ts` owns runtime identity/presentation, `types.ts` owns provider-private shared types, `runtime-context.ts` owns filesystem/env context, `input-projector.ts` owns Cradle input to provider-native input, `event-to-chunk-mapper.ts` owns provider events to AI SDK chunks, `state-projector.ts` owns provider snapshot projection, `ui-slot-projector.ts` owns runtime UI slot projection, `stream-diagnostics.ts` owns stream diagnostics, and `stream-handler.ts` owns single-turn stream notification orchestration. Providers should use these names instead of local synonyms when the responsibility exists. Protocol-heavy providers may group those responsibilities under owner directories such as `app-server/`, `config/`, `projection/`, and `turn/` when a flat package would hide boundaries.

## Files

- `kit/`: shared Provider Kit modules (chunk mapping, input projection, process hosting, permission bridging, state snapshot parsing, provider definition helpers). See `kit/README.md` for the real per-module adoption matrix.
- `bounded-text-collector.ts`: bounded streaming text accumulator for diagnostics.
- `async-event-queue.ts`: provider-agnostic async FIFO event queue for runtime streams.
- `openai-compatible/`: parked OpenAI-compatible AI SDK adapter; it is currently not registered as a builtin runtime.
- `acp/`: ACP process, connection, runtime integration, timeline mapping, and provider adapter.
- `opencode/`: opencode SDK server runtime adapter with native provider config projection, session lifecycle, prompt result mapping, and tool envelope mapping.
- `tools/`: Cradle-owned shared provider tool envelope contract.
- `claude-agent/`: Claude Agent SDK provider package using metadata, input, async stream, event-to-chunk, state, subagent, tool envelope, and test modules.
- `codex/`: Codex app-server provider package with a thin top-level facade and owner directories for app-server boundary, runtime config, Cradle projections, turn orchestration, and tool envelope mapping.
- `mock-claude-agent/provider.ts`: mock Claude Agent provider for local diagnostics.
- `system-agent/`: jar-core System Agent provider package using metadata, runtime context, input, model-registry bridge, event-to-chunk, state, and provider facade modules.
