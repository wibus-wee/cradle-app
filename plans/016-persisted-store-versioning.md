# Plan 016 — Version and validate persisted Zustand stores

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/web/src/navigation/surface-store.ts apps/web/src/store/browser-panel.ts apps/web/src/store/layout.ts` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — a bad `migrate` can wipe user tab/state; needs fixture tests with old payloads.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

Two persisted stores rehydrate untrusted localStorage without a `version`/`migrate` or schema validation: `surface-store` (open tabs/routes) and `browser-panel` (history, annotations). After a deploy that changes the persisted shape, rehydrated data can contain invalid routes/params or malformed objects, causing navigation or render-time throws. `store/layout.ts` already does this correctly (`version: 2` + `migrate`) — this plan brings the other two up to that standard.

## Current state

- Correct reference — `apps/web/src/store/layout.ts:135-152` (has `version: 2` + `migrate`).
- No versioning, only legacy-key deletion — `apps/web/src/navigation/surface-store.ts:254-267` (`persist({ name: SURFACE_STORAGE_KEY, onRehydrateStorage })`, no `version`/`migrate`).
- Unvalidated cast in merge — `apps/web/src/store/browser-panel.ts:1358-1372` (`merge` casts `persisted as BrowserPanelPersistedState` and merges history/annotation maps; no `version`/`migrate`).

(Read all three to confirm the exact lines before editing.)

## Commands you will need

| Purpose   | Command                          | Expected |
|-----------|----------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Tests     | `pnpm --filter @cradle/web test` | pass     |

## Scope

**In scope**:
- `apps/web/src/navigation/surface-store.ts` — add `version` + `migrate` that validates persisted surfaces with Zod, falling back to `[HOME_SURFACE]` on invalid entries.
- `apps/web/src/store/browser-panel.ts` — validate the persisted slice with Zod in `merge`/`onRehydrateStorage`; reset invalid keys to `{}`; add `version`.
- New tests using old/corrupt payload fixtures.

**Out of scope**: `store/layout.ts` (already correct); the store logic itself beyond rehydration.

## Steps

### Step 1: surface-store versioned migrate
Define a Zod schema for the persisted surface shape; add `version` and a `migrate` that parses each persisted surface, dropping invalid ones and falling back to `[HOME_SURFACE]` if none remain.

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0

### Step 2: browser-panel validated merge
In `merge`, parse `persisted` with a Zod schema instead of casting; reset `recentHistoryByOwnerId`/`annotationTrayCollapsedByOwnerId` to `{}` on invalid data; add `version`.

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0

### Step 3: Tests
- surface-store: a persisted payload with an invalid route rehydrates to a safe state (invalid dropped, home fallback), not a throw.
- browser-panel: a corrupt history object rehydrates to empty maps, not a throw.

**Verify**: `pnpm --filter @cradle/web test` → pass incl. new fixture tests

## Done criteria

- [ ] `pnpm --filter @cradle/web typecheck` exits 0
- [ ] `pnpm --filter @cradle/web test` passes incl. old-payload fixture tests
- [ ] Both stores have `version` + validation on rehydrate
- [ ] `plans/README.md` status row updated

## STOP conditions

- The persisted shape is more complex than the audit suggests and a faithful Zod schema is large enough to risk drift from the store type — STOP and report; consider deriving the schema from the store type.

## Maintenance notes

- Reviewer: verify `migrate` never throws (a throwing migrate blocks rehydrate entirely).
- Every future change to these persisted shapes must bump `version` and add a migrate branch.
