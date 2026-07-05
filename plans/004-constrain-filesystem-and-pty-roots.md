# Plan 004 — Constrain filesystem browse and shell cwd to allowed roots

> **Executor instructions**: Follow step by step; verify each step. Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/modules/filesystem apps/server/src/modules/pty` — mismatch vs excerpts = STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED — `browse` likely backs a file-picker UX; over-constraining breaks workspace import.
- **Depends on**: plans/002-http-ws-auth-plugin.md (auth is the primary boundary; this is defense-in-depth)
- **Category**: security
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

`filesystem.browse` resolves any client-supplied path (defaulting to the home directory) with no boundary, and the generic shell PTY spawns in a client-supplied `cwd`. Once the server is reachable beyond localhost (relay, widened `CRADLE_HOST`), these let a caller enumerate arbitrary host directories and open shells anywhere the server process can read. The workspace file APIs already do this correctly (`workspace/files.ts` uses `isWithinRoot`); this plan brings browse and shell up to the same standard.

## Current state

- `apps/server/src/modules/filesystem/service.ts:20-31` — no root constraint:

```20:31:apps/server/src/modules/filesystem/service.ts
export async function browse(requestedPath?: string): Promise<BrowseResult> {
  let raw = requestedPath?.trim() || homedir()
  // Expand ~ to home directory
  if (raw === '~' || raw.startsWith('~/')) {
    raw = homedir() + raw.slice(1)
  }
  const target = resolve(raw)

  const realStat = await stat(target)
  if (!realStat.isDirectory()) {
    throw new Error(`Not a directory: ${target}`)
  }
```

- `apps/server/src/modules/filesystem/index.ts:19-31` — exposed at `GET /filesystem/browse`.
- `apps/server/src/modules/pty/service.ts:367-383` — `startShell` passes client `cwd` straight to `ptyRuntime.ensureSession`:

```367:383:apps/server/src/modules/pty/service.ts
export function startShell(input: { ptyId: string, cwd: string, cols: number, rows: number }) {
  if (!ptyRuntime.isRunning(input.ptyId)) {
    ptyTimeline.reset(input.ptyId)
  }
  ptyRuntime.ensureSession({
    sessionId: input.ptyId,
    role: 'bottom-panel',
    executable: getDefaultShell(),
    args: [],
    cwd: input.cwd,
    ...
```

- Exemplar to match: `apps/server/src/modules/workspace/files.ts:737-765` — `resolveWorkspaceFilePath` + `isWithinRoot`. Read it and reuse the same containment helper.

## Commands you will need

| Purpose   | Command                                  | Expected |
|-----------|------------------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/server typecheck` | exit 0   |
| Tests     | `pnpm --filter @cradle/server test`      | all pass |

## Scope

**In scope**:
- `apps/server/src/modules/filesystem/service.ts` — constrain `browse` to an allowlist: registered workspace roots + home directory (for the picker) but reject traversal above those, or gate behind auth + an explicit "picker mode" flag.
- `apps/server/src/modules/pty/service.ts` — validate `startShell` `cwd` against registered workspace roots / session execution roots.
- `filesystem/service.test.ts`, `pty/service.test.ts` (create or extend).

**Out of scope**:
- Session-scoped PTYs that already derive cwd from a validated session root — only the generic `startShell` path.
- The workspace file APIs (already correct).

## Steps

### Step 1: Add a shared root-containment check
Reuse or extract `isWithinRoot` from `workspace/files.ts`. In `filesystem/service.ts`, compute the allowed roots (workspace roots via the workspace service + `homedir()` if picker UX requires it) and reject `browse` targets not contained in any allowed root with an `AppError` 403.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 2: Constrain shell cwd
In `pty/service.ts` `startShell`, resolve `cwd`, verify it is within a registered workspace root (or the session's execution root); throw `AppError` 400/403 otherwise.

**Verify**: `pnpm --filter @cradle/server test` → all pass

### Step 3: Tests
`browse` rejects a path outside all roots (e.g. `/etc`), accepts a workspace root and its children; `startShell` rejects a cwd outside roots, accepts a valid workspace cwd.

**Verify**: `pnpm --filter @cradle/server test` → all pass incl. new cases

## Done criteria

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0; new containment tests pass
- [ ] `browse('/etc')` and `startShell({cwd:'/'})`-style calls are rejected
- [ ] `plans/README.md` status row updated

## STOP conditions

- The file-picker UX genuinely needs to browse outside workspace roots (e.g. to import a brand-new folder) and no home-anchored allowlist satisfies it — STOP and report; the product contract needs confirmation before narrowing.
- No workspace-root registry is reachable from these modules without a layering violation — STOP and report.

## Maintenance notes

- If multi-folder/symlink workspaces are added, the containment check must resolve realpaths to avoid symlink escape.
- Reviewer: confirm picker UX still works for the intended import flow.
