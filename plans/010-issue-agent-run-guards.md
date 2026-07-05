# Plan 010 — Fix issue-agent run tracking races and delegation atomicity

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/modules/issue-agent` — mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — touches delegation/rerun control flow; needs the existing tests green plus new ones.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

Four related defects in `issue-agent/service.ts` corrupt run tracking: (1) a stale run watcher deletes the *current* run's tracking entry and marks the session completed/failed even though a newer run is streaming; (2) `delegateIssue` spawns a new run with no in-progress guard, so double-submits create concurrent runs for one issue; (3) `rerunSession`'s guard checks `activeRuns` before `runSession` sets it, so two rapid reruns both pass; (4) delegation performs four DB writes without a transaction, so a mid-flight failure leaves inconsistent state. Together these produce wrong UI state, wasted tokens, and duplicate agent output.

## Current state

- Stale-watcher clobber — `apps/server/src/modules/issue-agent/service.ts:166-222`:

```166:171:apps/server/src/modules/issue-agent/service.ts
async function watchRunCompletion(agentSessionId: string, runId: string): Promise<void> {
  try {
    const run = await ChatRuntime.waitForRunCompletion(runId)
    const tracked = activeRuns.get(agentSessionId)
    activeRuns.delete(agentSessionId)
```

The `tracked` entry is read but its `runId` is never compared to the completing `runId` before `activeRuns.delete` and the status mutations at `:181-210`. The `catch` at `:211-221` also deletes unconditionally.

- Delegation has no in-progress guard and does 4 writes then `void runSession` — `service.ts:601-629`:

```601:629:apps/server/src/modules/issue-agent/service.ts
  Issue.updateIssueDelegation(input.issueId, { ... })
  Issue.addComment({ ... })
  const session = AgentInteraction.createSession({ ... })
  AgentInteraction.createActivity({ ... })
  void runSession(session.id, { runInIsolation: input.runInIsolation })
  return { ...session, isCurrentDelegation: true }
```

- Rerun guard checks before tracking is set — `service.ts:636-646`:

```636:646:apps/server/src/modules/issue-agent/service.ts
  if (activeRuns.has(session.id)) {
    throw new AppError({ code: 'issue_agent_session_in_progress', status: 409, ... })
  }
  const refreshed = AgentInteraction.updateSessionStatus(session.id, 'created') ?? session
  void runSession(session.id)
```

`runSession` only does `activeRuns.set(...)` after `ChatRuntime.createRun` completes (per audit, `:379-390`) — read it to confirm.

- `db()` transaction helper is available via drizzle (`apps/server/src/infra.ts` `db()`).

## Commands you will need

| Purpose   | Command                                        | Expected |
|-----------|------------------------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/server typecheck`       | exit 0   |
| Tests     | `pnpm --filter @cradle/server test issue-agent`| pass     |

## Scope

**In scope**:
- `apps/server/src/modules/issue-agent/service.ts` — all four fixes.
- `apps/server/src/modules/issue-agent/*.test.ts` (extend).

**Out of scope**: `chat-runtime` run lifecycle (plan 011); `issue` module data model.

## Steps

### Step 1: Run-id guard in the watcher
In `watchRunCompletion`, after `const tracked = activeRuns.get(agentSessionId)`, early-return without mutating state when `tracked?.runId !== runId`. Apply the same guard in the `catch` block before `activeRuns.delete` and the failure status write.

**Verify**: `pnpm --filter @cradle/server test issue-agent` → pass

### Step 2: In-flight marker set at run start
In `runSession`, set a pending marker in `activeRuns` (e.g. `{ runId: 'pending', ... }` or a separate `startingSessions` set) at the very start, before `ChatRuntime.createRun`; replace with the real runId once created; clear on failure. This closes both the rerun double-start (Step 3 relies on it) and the delegation double-submit.

**Verify**: `pnpm --filter @cradle/server test issue-agent` → pass

### Step 3: Guard delegation against active runs
In `delegateIssue`, before creating a new session, reject (409) or serialize when the issue already has an active/in-progress delegation (check `getDelegation(issueId)` + `activeRuns`). Optionally auto-stop the prior run first if that is the intended product behavior — if unclear, reject and report.

**Verify**: `pnpm --filter @cradle/server test issue-agent` → pass

### Step 4: Wrap delegation writes in a transaction
Wrap the four writes (`updateIssueDelegation`, `addComment`, `createSession`, `createActivity`) in a single `db().transaction(...)`. Keep `void runSession` outside the transaction (it is async work, not a write). Ensure `runSession`'s own catch still records failure status.

**Verify**: `pnpm --filter @cradle/server test issue-agent` → pass

### Step 5: Tests
- Watcher: a stale completion (different runId) does not delete the current entry or change status.
- Delegation: second concurrent `delegateIssue` for the same issue is rejected/serialized.
- Rerun: two rapid `rerunSession` calls — only one run starts.
- Transaction: a forced failure in one of the four writes rolls back all.

**Verify**: `pnpm --filter @cradle/server test issue-agent` → pass incl. 4 new cases

## Done criteria

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test issue-agent` passes incl. new tests
- [ ] `plans/README.md` status row updated

## STOP conditions

- The intended delegation semantics on double-submit (reject vs replace) cannot be inferred from the code/tests — implement reject-with-409 and report the assumption.
- `runSession` internals differ materially from the audit's `:379-390` description — STOP and report.

## Maintenance notes

- Reviewer: verify the pending marker is always cleared on every early-return/throw path in `runSession`.
- This pattern (set-marker-before-await) is the same fix used in plan 011 for other registries — keep them consistent.
