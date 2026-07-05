# Plan 021 — Restore dependency direction: infra/http/lib must not import modules

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/http apps/server/src/lib apps/server/src/plugins` — mismatch = STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED — touches the import graph; DI wiring must move to bootstrap.
- **Depends on**: plans/019-fix-server-agents-doc-drift.md (align doc + code direction together)
- **Category**: tech-debt
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

`apps/server/AGENTS.md` states technical layers (`http/`, `lib/`, `database/`) must not import business `modules/*`. The code violates this: `http/request-logger.ts` and `http/error-mapping.ts` import `modules/observability/service`, `plugins/loader.ts` imports `modules/conversation-bridge`, and `lib/outbound-network.ts` imports `modules/preferences/service`. This creates circular-coupling risk and makes infra untestable in isolation. This plan introduces narrow ports so the direction is respected. It's P3 because it's structural hygiene, not a live defect.

## Current state (per audit — confirm each import before editing)

- `apps/server/src/http/request-logger.ts:5-6` — imports `modules/observability/service`.
- `apps/server/src/http/error-mapping.ts:5-6` — imports `modules/observability/contract` + `modules/observability/service`:

```1:6:apps/server/src/http/error-mapping.ts
import type { ErrorHandler } from 'elysia'

import { AppError } from '../errors/app-error'
import { getLogger } from '../logging/logger'
import { OBSERVABILITY_CODES } from '../modules/observability/contract'
import { record } from '../modules/observability/service'
```

- `apps/server/src/plugins/loader.ts:12-15` — imports `modules/conversation-bridge`.
- `apps/server/src/lib/outbound-network.ts:8-9` — imports `modules/preferences/service`.
- Rule source: `apps/server/AGENTS.md:42-45`.

## Commands you will need

| Purpose   | Command                                  | Expected |
|-----------|------------------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/server typecheck` | exit 0   |
| Tests     | `pnpm --filter @cradle/server test`      | all pass |

## Scope

**In scope**:
- `apps/server/src/http/error-mapping.ts`, `apps/server/src/http/request-logger.ts` — depend on an event-sink *interface* (port), injected at `app.ts` bootstrap, rather than importing `modules/observability` directly.
- `apps/server/src/lib/outbound-network.ts` — take preferences via a port/param instead of importing `modules/preferences`.
- `apps/server/src/plugins/loader.ts` — depend on a conversation-bridge port instead of the module internals.
- `apps/server/src/app.ts` — wire the concrete implementations at composition time.
- Corresponding tests.

**Out of scope**: moving observability's storage; changing the observability event schema; god-file splits (plan 020).

## Steps

### Step 1: Define an event-sink port
Create a small interface (e.g. in `http/ports.ts` or `errors/`) for `recordEvent(input)`; have `error-mapping.ts`/`request-logger.ts` accept it via their factory (`createErrorHandler(sink)` / `createRequestLoggerPlugin(sink)`).

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 2: Wire the concrete sink at bootstrap
In `app.ts`, pass the `modules/observability/service` `record` as the sink implementation when constructing the plugins.

**Verify**: `pnpm --filter @cradle/server test` → all pass

### Step 3: Invert outbound-network's preferences dependency
Change `outbound-network.ts` to receive the preferences value/reader as a parameter (or a port), and inject it at the call sites.

**Verify**: `pnpm --filter @cradle/server test` → all pass

### Step 4: Invert plugins/loader's conversation-bridge dependency
Introduce a bridge port consumed by the loader; wire the concrete module at bootstrap.

**Verify**: `pnpm --filter @cradle/server test` → all pass

### Step 5: Guard against regressions
Add an ast-grep/lint rule (the repo has `ast-grep`/`sgconfig.yml`) or a test that fails if `http/`, `lib/`, or `plugins/` import from `modules/`.

**Verify**: the rule flags a deliberately-added bad import in a scratch test, then remove the scratch.

## Done criteria

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0
- [ ] `rg -n "from '\.\./modules/" apps/server/src/http apps/server/src/lib` returns nothing (or only type-only imports if unavoidable, documented)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Breaking a dependency requires restructuring observability itself (large blast radius) — STOP and report; scope this plan to http/lib/plugins only and defer the rest.

## Maintenance notes

- Reviewer: confirm DI happens only at `app.ts` bootstrap, per the documented "composition only" rule.
- Pairs with plan 019 so doc and code agree on the dependency direction.
