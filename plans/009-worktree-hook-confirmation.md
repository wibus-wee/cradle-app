# Plan 009 — Gate worktree setup-hook execution behind confirmation

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/modules/worktree` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED — hooks are intentional for trusted workspaces; requiring confirmation changes behavior.
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

`runWorktreeSetupHooks` reads `.cradle/worktrees.json` from the workspace and runs each entry via `execFileAsync('sh', ['-lc', command])`. Because `.cradle/worktrees.json` lives in the workspace (which may be cloned from an untrusted source or writable by an attacker who has any workspace write access), commands execute with server privileges on the next worktree creation — arbitrary code execution from repo content. This plan requires an explicit trust decision before auto-running hooks.

## Current state

```12:42:apps/server/src/modules/worktree/worktree-setup.ts
/** Runs optional `.cradle/worktrees.json` hooks after checkout creation (Cursor-style). */
export async function runWorktreeSetupHooks(
  workspacePath: string,
  checkoutPath: string,
): Promise<string[]> {
  const configPath = join(workspacePath, '.cradle', 'worktrees.json')
  if (!existsSync(configPath)) {
    return []
  }
  ...
  for (const command of commands) {
    try {
      await execFileAsync('sh', ['-lc', command], { cwd: checkoutPath })
    }
    ...
  }
  return warnings
}
```

## Commands you will need

| Purpose   | Command                                  | Expected |
|-----------|------------------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/server typecheck` | exit 0   |
| Tests     | `pnpm --filter @cradle/server test`      | all pass |

## Scope

**In scope**:
- `apps/server/src/modules/worktree/worktree-setup.ts` — add a trust gate: only run hooks when the workspace is marked trusted (a stored per-workspace grant) or the operator explicitly confirmed; disable auto-run when the server is relay-exposed.
- The caller of `runWorktreeSetupHooks` (find via grep) — thread the trust decision.
- `worktree/*.test.ts` (create or extend).

**Out of scope**: worktree creation logic itself.

## Steps

### Step 1: Add a trust parameter
Change `runWorktreeSetupHooks` to accept a `trusted: boolean` (or a callback that resolves trust). When not trusted, return a warning listing the commands that would have run, without executing them.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 2: Thread trust from the caller
Find the caller (`grep -rn runWorktreeSetupHooks apps/server/src`) and pass a per-workspace trust grant; default to untrusted for newly imported/cloned workspaces and when relay-exposed.

**Verify**: `pnpm --filter @cradle/server test worktree` → pass

### Step 3: Tests
Untrusted workspace: hooks are not executed and a warning is returned; trusted workspace: hooks run as before.

**Verify**: `pnpm --filter @cradle/server test worktree` → pass

## Done criteria

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0; trust-gate tests pass
- [ ] Untrusted workspace does not execute setup commands
- [ ] `plans/README.md` status row updated

## STOP conditions

- There is no per-workspace trust concept anywhere and adding one requires schema work that conflicts with other plans — STOP and report (coordinate with plan 007's schema touch).

## Maintenance notes

- Reviewer: confirm the UX surfaces the pending hooks so a user can grant trust deliberately.
- Consider an allowlist of command shapes as a future tightening.
