# Plan 023 — Consolidate web data-fetching onto generated react-query hooks

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/web/src/features/chronicle apps/web/src/features/automation apps/web/src/features/search apps/web/src/api-gen` — mismatch = STOP.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED — migrating many call sites; cache-invalidation semantics must be preserved.
- **Depends on**: plans/022-web-critical-path-tests.md (test net for chronicle before migrating it)
- **Category**: tech-debt
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

Four+ server-fetch patterns coexist: generated `@tanstack/react-query.gen` hooks, hand-rolled `fetch(\`${getServerUrl()}...\`)` in chronicle, a bespoke fetch client in automation, and manual fetch in search `queryFn` — plus SSE for live chat tails. Cache invalidation, error handling, retry, and typing diverge per feature, and a server API change means hunting multiple client patterns. This plan picks the generated react-query hooks as the default and migrates the manual fetchers, keeping SSE/streaming as the explicit documented exception.

## Current state (per audit — confirm before editing)

- Generated hooks (the target pattern): `apps/web/src/features/agent-runtime/use-agents.ts:57-62`.
- Hand-rolled fetch: `apps/web/src/features/chronicle/use-chronicle.ts:951-956` (`requestChronicleJson`).
- Bespoke client: `apps/web/src/features/automation/api-client.ts:137`.
- Manual fetch in queryFn: `apps/web/src/features/search/use-chronicle-search.ts:50`.
- Explicit exception (keep): `apps/web/src/features/chat/session/session-sync-engine.ts:17-25` (SSE tail).
- Generated client lives in `apps/web/src/api-gen` (`sdk.gen.ts`, `@tanstack/react-query.gen.ts`) — regenerated via `pnpm --filter @cradle/web generate`.

## Commands you will need

| Purpose   | Command                          | Expected |
|-----------|----------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Tests     | `pnpm --filter @cradle/web test` | pass     |

## Scope

**In scope**:
- `features/chronicle/use-chronicle.ts`, `features/automation/api-client.ts`, `features/search/use-chronicle-search.ts` — migrate to generated react-query hooks where an endpoint exists.
- A short doc note (in `apps/web/src/features/README.md` or `api-gen`) declaring generated hooks the default and SSE/streaming the exception.

**Out of scope**: chat SSE/streaming; endpoints not present in the generated client (report them); splitting the god files (plan 020).

## Steps

Migrate ONE feature at a time; verify after each.

### Step 1: Inventory
For each manual fetch call, find the matching generated hook in `api-gen/@tanstack/react-query.gen.ts`. List any endpoint with no generated equivalent — those may need server OpenAPI additions (report, don't hand-roll).

**Verify**: an inventory list produced; `pnpm --filter @cradle/web typecheck` → exit 0

### Step 2: Migrate search
Replace the manual `queryFn` in `use-chronicle-search.ts` with the generated hook; preserve query keys/invalidation.

**Verify**: `pnpm --filter @cradle/web test search` → pass

### Step 3: Migrate automation
Replace `automation/api-client.ts` fetchers with generated hooks; keep mutation invalidation behavior.

**Verify**: `pnpm --filter @cradle/web test automation` → pass

### Step 4: Migrate chronicle
With plan 022 tests in place, replace `requestChronicleJson` calls with generated hooks endpoint by endpoint.

**Verify**: `pnpm --filter @cradle/web test chronicle` → pass

### Step 5: Document the convention
Add the short note declaring generated hooks default + SSE exception.

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0; `pnpm --filter @cradle/web test` → pass

## Done criteria

- [ ] `pnpm --filter @cradle/web typecheck` exits 0
- [ ] `pnpm --filter @cradle/web test` passes
- [ ] `rg -n "getServerUrl\(\)\}\`" apps/web/src/features/chronicle apps/web/src/features/search apps/web/src/features/automation` returns nothing (manual fetches removed) — except documented SSE exceptions
- [ ] `plans/README.md` status row updated

## STOP conditions

- An endpoint used by a manual fetcher has no generated equivalent and generating one requires server changes — STOP and report the missing endpoints; do not hand-roll a parallel client.
- Migrating changes cache-invalidation timing in a user-visible way — STOP and report.

## Maintenance notes

- Do this AFTER plan 022 (chronicle test net) and ideally alongside/after plan 020's chronicle split.
- Reviewer: confirm query keys and invalidation match the old behavior; watch for double-fetch or stale-cache regressions.
