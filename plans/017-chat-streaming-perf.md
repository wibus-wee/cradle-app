# Plan 017 — Reduce chat streaming render cost

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/web/src/features/chat/rendering apps/web/src/store/chat apps/web/src/features/chat/ui` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — memoization must respect partial tool-input streaming semantics.
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

During streaming (flushes ~every 125ms), the chat render path does avoidable work: the 1500-line `describeToolCall` classifier runs inside a render-plan selector across all parts on every flush; a streaming-ids selector allocates a fresh `Set` on every store read, defeating `useShallow` reference comparison and re-rendering the scroll runtime/virtualizer each flush. On tool-heavy runs this is the primary UX latency surface. This plan caches classification and stabilizes the selector.

## Current state

- Classifier in a selector — `apps/web/src/features/chat/rendering/message-bubble-selectors.ts:205-219`:

```205:220:apps/web/src/features/chat/rendering/message-bubble-selectors.ts
export function readRenderSegmentsFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  textTransform?: MessageTextTransform,
): ChatRenderSegment[] {
  const message = readMessageFromState(state, sessionId, messageId, textTransform)
  if (!message) {
    return EMPTY_RENDER_SEGMENTS
  }
  return groupMessagePartRefs({
    parts: message.parts,
    messageId: message.id,
    describeToolKind: part => describeToolCall(part).kind,
  })
}
```

- Fresh `Set` per read — `apps/web/src/store/chat/store.ts:528-536,739-740` (`readStreamingMessageIds` allocates `new Set()`); consumed via `useShallow` in `apps/web/src/features/chat/ui/use-chat-scroll-runtime.ts:127-143`, feeding `keepMountedIndices`.
- Streaming batches at 125ms — `apps/web/src/features/chat/rendering/chat-streaming-handler.ts:9,133-158`.
- Positive context (don't redo): chat list is virtualized (`chat-transcript-pane.tsx:86-95`), `messageIds` uses WeakMap caching (`store/chat/store.ts:502-509`), React Compiler is enabled.

## Commands you will need

| Purpose   | Command                          | Expected |
|-----------|----------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Tests     | `pnpm --filter @cradle/web test` | pass     |

## Scope

**In scope**:
- `apps/web/src/features/chat/rendering/message-bubble-selectors.ts` (+ the classifier call site) — cache `describeToolCall` results keyed by `(toolCallId, state, inputHash, outputHash)`.
- `apps/web/src/store/chat/store.ts` — return a stable empty `Set` singleton when idle; memoize the streaming-id set until membership changes (or expose a primitive active-id where possible).
- Tests for the cache and the selector stability.

**Out of scope**: Streamdown internals (that's a separate profiling item — note in maintenance); the streaming batch interval.

## Steps

### Step 1: Cache tool classification
Introduce a cache (WeakMap keyed by part ref, or a Map keyed by `(toolCallId, state, inputHash, outputHash)`) so `describeToolCall` is not recomputed for unchanged parts across flushes. Respect partial tool-input streaming: the key must include whatever changes as input streams in.

**Verify**: `pnpm --filter @cradle/web test` → pass

### Step 2: Stabilize streaming-id selector
Return a shared frozen empty `Set` when there are no streaming messages; when non-empty, memoize the `Set` and only produce a new reference when membership actually changes. Confirm `use-chat-scroll-runtime` no longer re-renders on every flush when membership is unchanged.

**Verify**: `pnpm --filter @cradle/web test` → pass

### Step 3: Tests
- Classification cache returns the same result object for an unchanged part and recomputes when input/output changes.
- Streaming-id selector returns a stable reference across reads when membership is unchanged.

**Verify**: `pnpm --filter @cradle/web test` → pass incl. new cases

## Done criteria

- [ ] `pnpm --filter @cradle/web typecheck` exits 0
- [ ] `pnpm --filter @cradle/web test` passes incl. cache + selector-stability tests
- [ ] `plans/README.md` status row updated

## STOP conditions

- The chat README documents streaming semantics that make a stable cache key impossible without breaking partial-input rendering — STOP and report; correctness beats this perf win.

## Maintenance notes

- Deferred: profile Streamdown markdown re-parse per flush (PERF item); if hot, throttle text-part selector updates separately from tool parts.
- Reviewer: verify streaming tool calls still update live (cache invalidates on input/output change).
