# Plan 019 — Rewrite apps/server/AGENTS.md to match the Elysia architecture

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/AGENTS.md apps/server/src/app.ts` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — documentation only.
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

`apps/server/AGENTS.md` documents a Tsuki/Hono/tsyringe architecture (`@tsuki-hono/core`, `createApplication`, a Hono request pipeline, `app.module.ts`, `guards/`), but the server actually runs Elysia (`new Elysia({ adapter: node() })`) with a flat module-composition in `app.ts`. Agents and contributors reading this file follow the wrong bootstrap, DI, and layering patterns — the stale doc actively suppresses the real architecture. This is high-leverage because agents execute against this file constantly.

## Current state

- `apps/server/AGENTS.md:7-9,72-78` — documents `@tsuki-hono/core`, `createApplication`, Hono pipeline, `app.module.ts`/`guards/` layout.
- Actual stack — `apps/server/src/app.ts:1-3,95-99`:

```1:3:apps/server/src/app.ts
import { cors } from '@elysiajs/cors'
import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'
```

```95:99:apps/server/src/app.ts
  const app = new Elysia({
    name: 'cradle.server.elysia',
    adapter: node(),
    normalize: 'typebox'
  })
```

- Real layout (from recon): `apps/server/src/` has `app.ts` (composition via `app.use(module)`), `index.ts` (bootstrap + process handlers), `infra.ts` (lazy singletons: config/logger/db), `http/` (request-id, error-mapping, request-logger, openapi, and — after plan 002 — auth), `modules/*` (business), `errors/AppError`, `config/`, `logging/`, `telemetry/`, `observability/`.
- Note: the dependency-direction rules in the current doc (`modules/*` may depend on infra; infra must not depend on modules) are still a *good* target — but plan 021 shows the code currently violates them. Keep the rule, and either note the known violations or reference plan 021.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| (docs only) | `git diff apps/server/AGENTS.md` | shows the rewrite |

## Scope

**In scope**:
- `apps/server/AGENTS.md` — rewrite to describe: Elysia module composition in `app.ts`; the real `src/` layout; `AppError` + `http/error-mapping` as the error contract; TypeBox schemas + `x-cradle-cli` metadata convention (as seen in `modules/workspace/index.ts`); verification commands (`pnpm --filter @cradle/server typecheck` / `test`).

**Out of scope**: the root `AGENTS.md`/`CLAUDE.md` (frontend-focused, separate); code changes.

## Steps

### Step 1: Rewrite
Replace Tsuki/Hono/tsyringe content with the Elysia reality. Keep the still-valid dependency-direction rules; add a one-line pointer that `http/` and `lib/` currently import `modules/*` in a few places and that plan 021 addresses it (so the doc isn't aspirational-only without acknowledging drift).

**Verify**: `git diff apps/server/AGENTS.md` shows Tsuki/Hono references removed and Elysia described.

### Step 2: Cross-check accuracy
Confirm every path and command named in the doc exists (spot-check with `ls`/`grep`).

**Verify**: `grep -n "tsuki\|createApplication\|app.module.ts" apps/server/AGENTS.md` returns nothing.

## Done criteria

- [ ] `grep -in "tsuki\|hono\|tsyringe\|createApplication" apps/server/AGENTS.md` returns nothing (except where deliberately explaining the removal, if any)
- [ ] The doc names Elysia, `app.ts`, `infra.ts`, `http/`, `AppError`, and the real verification commands
- [ ] `plans/README.md` status row updated

## STOP conditions

- There is evidence the server is mid-migration from Tsuki to Elysia (both stacks present and wired) — STOP and report; the doc should then describe the migration state, not just Elysia.

## Maintenance notes

- Reviewer: verify no command in the doc is guessed — each must be the real script from `apps/server/package.json`.
