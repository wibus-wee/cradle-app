# Plan 011 — Coalesce check-then-act races on connection/process registries

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/modules/relay-servers apps/server/src/modules/conversation-bridge apps/server/src/modules/relay-transport` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: S (per site; M total)
- **Risk**: LOW — standard promise-coalescing / reserve-before-await.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

Several supervisors follow "check a map, then do async setup, then insert into the map". Concurrent callers both pass the check and each start a duplicate: two relayd child processes, two conversation-bridge runtimes, two `/ws/host` connections. Duplicates leak processes/sockets and produce flaky connect/disconnect state. `remote-hosts` already does this correctly (promise stored before await) — this plan applies the same pattern to the sites that don't.

## Current state

- Correct exemplar — `apps/server/src/modules/remote-hosts/service.ts:337-347`:

```337:347:apps/server/src/modules/remote-hosts/service.ts
export async function connectRemoteHostCradleServer(hostId: string): Promise<RemoteCradleServerConnectionView> {
  const existingPromise = connectPromises.get(hostId)
  if (existingPromise) {
    return existingPromise
  }
  const promise = connectRemoteHostCradleServerInner(hostId).finally(() => {
    connectPromises.delete(hostId)
  })
  connectPromises.set(hostId, promise)
  return promise
}
```

- Racy — `apps/server/src/modules/relay-servers/local-relayd-supervisor.ts:48-77`: checks `runningLocalRelayd` then awaits port allocation + spawn before assigning `runningLocalRelayd`:

```48:53:apps/server/src/modules/relay-servers/local-relayd-supervisor.ts
export async function startManagedLocalRelayd(): Promise<void> {
  if (runningLocalRelayd || !shouldStartManagedLocalRelayd()) {
    return
  }
  const launch = await resolveLocalRelaydLaunch()
```

- Racy — `apps/server/src/modules/conversation-bridge/runtime-supervisor.ts:128-171`: `runningConnections.has` check, then DB/adapter setup, then `runningConnections.set` (per audit — read to confirm).
- Racy — `apps/server/src/modules/relay-transport/host-connector.ts:346-395`: `this.connections.has(enrollmentId)` check, then construct `HostConnection`, then `this.connections.set` (per audit — read to confirm).

Note: `remote-hosts` itself (`:337-347`) is already correct — do NOT change it; use it only as the reference.

## Commands you will need

| Purpose   | Command                                  | Expected |
|-----------|------------------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/server typecheck` | exit 0   |
| Tests     | `pnpm --filter @cradle/server test`      | all pass |

## Scope

**In scope**:
- `apps/server/src/modules/relay-servers/local-relayd-supervisor.ts`
- `apps/server/src/modules/conversation-bridge/runtime-supervisor.ts`
- `apps/server/src/modules/relay-transport/host-connector.ts`
- Corresponding `*.test.ts` where they exist (extend).

**Out of scope**: `remote-hosts/service.ts` (already correct); `issue-agent` (plan 010).

## Steps

### Step 1: local-relayd single-flight latch
Add a module-level `startingPromise: Promise<void> | null`. `startManagedLocalRelayd` returns the in-flight promise if present; otherwise creates it, stores it before awaiting spawn/ready, and clears it in `finally`. Ensure `runningLocalRelayd` is set (or the promise reused) so a second concurrent call never spawns a second child.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 2: conversation-bridge reserve-before-await
Reserve the connection id in `runningConnections` (or a `startingConnections` set) before async setup; remove on failure; if a restart races, abort the previous runtime rather than starting a second.

**Verify**: `pnpm --filter @cradle/server test conversation-bridge` → pass (if tests exist)

### Step 3: host-connector reserve-before-await
Insert a placeholder connection (or in-flight promise) into `this.connections` for `enrollmentId` before `connection.start()`; clean up on failure.

**Verify**: `pnpm --filter @cradle/server test` → all pass

### Step 4: Tests
For at least one site (host-connector is the cleanest), add a test that fires two concurrent starts for the same id and asserts a single connection/process is created. Use fakes for the child process / socket.

**Verify**: `pnpm --filter @cradle/server test` → all pass incl. new race test

## Done criteria

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0; race test passes
- [ ] `plans/README.md` status row updated

## STOP conditions

- A supervisor's failure path can't cleanly release the reserved slot (e.g. partial spawn with no handle) — STOP and report; leaking a reserved-but-empty slot is worse than the race.

## Maintenance notes

- Consider extracting a tiny `singleFlight<K>(map, key, fn)` helper so future supervisors don't reinvent this; note it but keep this plan's diff minimal.
- Reviewer: confirm every early-return and throw clears the reservation.
