# Plan 013 — Include apps/web tests in the root test run

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- vitest.config.ts apps/web/vite.config.ts package.json` — mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — but may expose pre-existing web test failures once included (that's the point).
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

The root `vitest.config.ts` `include` array does not cover `apps/web/**`, so the ~65 web test files run only via `pnpm --filter @cradle/web test`. Anyone running root `pnpm test` (CI, contributors) gets a green result that says nothing about the primary React frontend — chat streaming, stores, and classifier regressions can ship unnoticed. This makes the whole test suite a reliable signal.

## Current state

```13:33:vitest.config.ts
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      ...
      'plugins/**/__tests__/**/*.test.tsx',
    ],
    mockReset: true,
  },
```

Note: the root config uses `environment: 'node'`, but web tests need `jsdom` (see `apps/web/package.json:11`: `vitest run --config vite.config.ts --environment jsdom src`). A single flat `include` with one environment will not work for web — web needs jsdom + its own vite config (React plugin, aliases). The correct tool is Vitest **projects** (workspace), not just adding globs.

## Commands you will need

| Purpose      | Command                          | Expected |
|--------------|----------------------------------|----------|
| Root tests   | `pnpm test`                      | runs server + web + packages |
| Web only     | `pnpm --filter @cradle/web test` | pass     |
| Typecheck    | `pnpm typecheck` (if defined)    | exit 0   |

## Scope

**In scope**:
- `vitest.config.ts` (root) — convert to a projects/workspace setup so `@cradle/web` runs under jsdom with its own config, while existing node projects keep their config.
- Root `package.json` `test` script if it needs adjusting to run all projects.

**Out of scope**: fixing whatever web tests newly surface as failing — record them as follow-ups, don't silence them.

## Steps

### Step 1: Convert root vitest to projects
Use Vitest's `projects` (or `test.projects`) to define: (a) the existing node project (current include + `environment: 'node'`); (b) a web project pointing at `apps/web` with `environment: 'jsdom'` and the web vite config (React plugin, tsconfig paths). Reuse `apps/web/vite.config.ts` as the web project's config.

**Verify**: `pnpm test` → executes web tests (you can see jsdom tests in the output)

### Step 2: Confirm web tests actually run
Count that ~65 web test files are collected.

**Verify**: `pnpm test 2>&1 | grep -c "apps/web"` → non-zero, and the run includes web test files

### Step 3: Record any newly-failing web tests
If including web surfaces failures, DO NOT delete or skip them silently. List them in `plans/README.md` under a follow-up note (or a new plan) so they're tracked.

**Verify**: `pnpm --filter @cradle/web test` still passes on its own (baseline)

## Done criteria

- [ ] `pnpm test` runs both server (node) and web (jsdom) tests
- [ ] The web project uses jsdom and the web vite config (not node env)
- [ ] Any new failures are recorded, not silenced
- [ ] `plans/README.md` status row updated

## STOP conditions

- Merging web (jsdom) and server (node) into one Vitest run causes environment or alias conflicts that can't be resolved with projects — STOP and report; keep them as separate `pnpm -r test` invocation instead and document that as the canonical command.

## Maintenance notes

- Reviewer: confirm CI invokes the root command that now includes web.
- Once green, wire this into CI as the single source of truth.
