# Plan 074: OrbStack high-concurrency sidecar sandbox POC

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED — container engine availability varies by host
- **Depends on**: Plan 036 (Work + managed worktree) already landed
- **Category**: execution infrastructure / POC
- **Implemented**: `apps/server/src/modules/sandbox/`

## Why

Work isolation today is git worktree only. Operators need concurrent OS-level
environments (deps, network, destructive tests) without replacing worktrees or
moving the Agent inside a container.

## Decisions

1. Sidecar pool + `exec` (Agent stays on host).
2. Default RO worktree mount; optional RW.
3. JSON store under `CRADLE_DATA_DIR/sandboxes` (no Drizzle migration for POC).
4. Docker CLI adapter (OrbStack-compatible) + mock runtime for CI.
5. Caps: `minWarm=1`, `maxTotal=16`, `maxPerWork=4` (env-overridable).
6. CLI + Work lease routes; no Aside UI in this plan.
7. Iron Law: no Chat Runtime / Claude turn scheduling ownership.

## Done criteria

- [x] `modules/sandbox` with profiles, lease, exec, release, reconcile
- [x] Mock runtime focused tests
- [x] Work detail includes `sandboxes`; archive releases leases
- [x] Maintenance reconcile task registered
- [x] Module README + this plan

## Verification

```bash
pnpm --filter @cradle/server exec vitest run src/modules/sandbox --maxWorkers=1 --reporter=dot
pnpm --filter @cradle/server typecheck
pnpm --filter @cradle/server check:boundaries
```
