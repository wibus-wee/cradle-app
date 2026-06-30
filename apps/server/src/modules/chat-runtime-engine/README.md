# chat-runtime-engine

Pure AI SDK turn execution helpers for chat runtime providers.

This module owns message conversion, token usage projection, stream execution, compaction, and tool exports that are specific to AI SDK chat turns. Chat Runtime owns sessions, queues, run lifecycle, trace storage, and persistence.

## Files

- `ai-sdk-engine.ts`: AI SDK message conversion, turn execution, stream chunk projection, usage normalization, and context compaction hooks.
- `ai-sdk-engine.test.ts`: focused coverage for AI SDK engine behavior.
- `compaction.ts`: model-message compaction helpers for bounded context windows.
- `providers.ts`: AI SDK language model factory helpers for configured provider profiles.
- `index.ts`: public barrel for chat runtime engine helpers.
- `tools/index.ts`: AI SDK tool exports used by engine callers.

