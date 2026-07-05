# Plan 012 — Terminal cleanup + error handling on run lifecycle and boot tasks

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/app.ts apps/server/src/modules/chat-runtime/run apps/server/src/modules/chat-runtime/runtime.ts apps/server/src/modules/provider-runtime apps/server/src/modules/chat-runtime-providers/opencode` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — run lifecycle must not double-release or skip queue drain.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

Four leaks in the streaming-run and boot paths: (1) `executeRun` isn't wrapped in `try/finally`, so a throw after terminal persistence but before `releaseActiveRun` leaves the session marked active forever — blocking new turns until restart; (2) two boot tasks are fired with `void` and no `.catch`, so a rejection becomes an unhandled rejection that the fatal handler turns into a process exit; (3) provider-runtime host disposal swallows errors, leaving zombie processes; (4) OpenCode SSE-subscribe failures fall into an empty catch, producing hung runs. These are the failure modes that require a manual restart.

## Current state

- No `try/finally` around the run body — `apps/server/src/modules/chat-runtime/run/turn-executor.ts:120-152`:

```120:152:apps/server/src/modules/chat-runtime/run/turn-executor.ts
export async function executeRun(
  activeRun: ActiveRun,
  input: ExecuteRunInput,
  deps: TurnExecutorDeps
): Promise<void> {
  const diagnostics = createTurnOutputDiagnostics()
  const profile = startChatRuntimeProfile()
  const { finalChunk, failurePayload } = await pumpRuntimeStream(...)
  const { actualModelId, shouldFinalizeDiagnostics } = await persistRunTerminalAndUsage(...)
  completeRun(activeRun, finalChunk, ...)   // releaseActiveRun happens inside completeRun
}
```

`executeRun` is invoked as `void executeRunWithDeps(...)` in `apps/server/src/modules/chat-runtime/runtime.ts:311-313` (per audit).

- Boot tasks without `.catch` — `apps/server/src/app.ts:286-287`:

```286:287:apps/server/src/app.ts
    void conversationBridgeSupervisor.startEnabledConversationBridgeConnections()
    void localRelaydSupervisor.startManagedLocalRelayd()
```

Contrast the neighboring tasks at `app.ts:259-285`, which all `.catch(...)` and log.

- Swallowed disposal — `apps/server/src/modules/provider-runtime/host-manager.ts:267-273` (`void disposeResource(...)`, `.catch(() => undefined)`).
- OpenCode empty catch — `apps/server/src/modules/chat-runtime-providers/opencode/provider.ts:1107-1195` (`event.subscribe(...)` failure → empty catch → `void submitAsyncPromptTurn()`).

## Commands you will need

| Purpose   | Command                                  | Expected |
|-----------|------------------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/server typecheck` | exit 0   |
| Tests     | `pnpm --filter @cradle/server test`      | all pass |

## Scope

**In scope**:
- `apps/server/src/modules/chat-runtime/run/turn-executor.ts` — wrap the body so the active run is always released and queue drain scheduled, even on throw.
- `apps/server/src/app.ts` — add `.catch` loggers to the two boot tasks.
- `apps/server/src/modules/provider-runtime/host-manager.ts` — log disposal failures with host id/runtime kind; escalate repeated failures via observability.
- `apps/server/src/modules/chat-runtime-providers/opencode/provider.ts` — log/metric the subscribe failure; fail fast (`chunks.fail(...)`) when recovery preconditions aren't met.
- Corresponding `*.test.ts`.

**Out of scope**: the run registry data structure; provider streaming semantics beyond error surfacing.

## Steps

### Step 1: Guarantee terminal release
Wrap `executeRun`'s body in `try { ... } finally { deps.releaseActiveRun(activeRun); /* schedule queue drain */ }`, but ensure `completeRun`'s existing release isn't double-invoked — either move the release solely into `finally` and have `completeRun` not release, or guard with an idempotent release. Confirm `releaseActiveRun` is idempotent or make it so.

**Verify**: `pnpm --filter @cradle/server test` → all pass (existing run tests green)

### Step 2: Boot task error handling
Add `.catch` loggers to the two `void` boot tasks in `app.ts`, matching the `console.error`/observability style of the adjacent tasks.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 3: Disposal logging
In `host-manager.ts` `disposeHostResource`, log failures (host id + runtime kind) instead of `.catch(() => undefined)`; for child-process disposers, attempt a force-kill; record repeated failures via the observability `record(...)` helper.

**Verify**: `pnpm --filter @cradle/server test` → all pass

### Step 4: OpenCode subscribe failure surfacing
Replace the empty catch at `opencode/provider.ts:1107-1195` with a log/metric; when the async-prompt recovery preconditions aren't met, call `chunks.fail(...)` so the run terminates instead of hanging.

**Verify**: `pnpm --filter @cradle/server test opencode` → pass

### Step 5: Tests
- A thrown error inside `executeRun` still releases the active run (assert `hasActiveRunForSession` is false afterward).
- Disposal failure is logged/recorded (spy on logger/record).

**Verify**: `pnpm --filter @cradle/server test` → all pass incl. new cases

## Done criteria

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0; new lifecycle tests pass
- [ ] `grep -n "void localRelaydSupervisor.startManagedLocalRelayd()" apps/server/src/app.ts` shows a `.catch` attached (or the call refactored)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `releaseActiveRun` is not idempotent and making it so risks skipping queue drain — STOP and report the release/drain contract.
- The OpenCode recovery path is load-bearing in a way that `chunks.fail` would regress happy-path turns — STOP and report.

## Maintenance notes

- Reviewer: the `try/finally` change is the highest-risk edit — scrutinize double-release and queue-drain ordering.
- Deferred: graceful shutdown calling `abortAllRuns` (currently mitigated by `recoverPersistedRunProjections` on next boot).
