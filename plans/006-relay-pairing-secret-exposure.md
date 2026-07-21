# Plan 006 — Stop returning relay pairing codes on read routes

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/modules/relay-transport` — mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED — pairing UX for legitimate local operators must keep working.
- **Depends on**: plans/002-http-ws-auth-plugin.md
- **Category**: security
- **Planned at**: commit `ac47f3b`, 2026-07-05
- **Completed**: 2026-07-20 — list/get use `pairable` (no `pairingCode`); create returns `pairingString` once; explicit `pairing-string` re-read kept for pending enrollments; UI uses `pairable` for show-again.

## Why this matters

`toView()` includes the `pairingCode`, and `GET /relay-transport/host-enrollments` and `.../pairing-string` are unauthenticated. Anyone who can reach the API can read active pairing codes and complete controller enrollment without physical access to the pairing UI — hijacking the relay trust boundary. Pairing secrets should be shown once at creation and never re-served on list/get.

## Current state

- `apps/server/src/modules/relay-transport/host-enrollment-service.ts:221-236` — `toView()` includes `pairingCode`.
- `apps/server/src/modules/relay-transport/index.ts:17-50` — `GET /relay-transport/host-enrollments` and `.../pairing-string` with no auth.
- `apps/server/src/modules/relay-transport/model.ts:26` — `pairingCode` in the response schema.

(Read all three to confirm exact line numbers before editing — the audit cited them; verify against live code.)

## Commands you will need

| Purpose   | Command                                  | Expected |
|-----------|------------------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/server typecheck` | exit 0   |
| Tests     | `pnpm --filter @cradle/server test`      | all pass |

## Scope

**In scope**:
- `host-enrollment-service.ts` — split the view: creation returns the pairing code once; `toView()` used by list/get omits it.
- `model.ts` — remove `pairingCode` from the list/get response schema; add a create-only response type that includes it.
- `index.ts` — gate `pairing-string` behind the plan-002 local auth; add short TTL + rate limit on pairing codes if not present.
- `relay-transport/*.test.ts`.

**Out of scope**: the enrollment handshake protocol itself; relay token minting (plan 003).

## Steps

### Step 1: Split creation vs read views
Add `toCreateView()` (includes `pairingCode`) and change `toView()` to omit it. Update callers so only the create endpoint uses the create view.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 2: Update schemas
Remove `pairingCode` from the list/get TypeBox schema; add it only to the create response schema.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 3: Gate + expire pairing codes
Require auth on `pairing-string`; give pairing codes a short TTL (e.g. a few minutes) and mark them consumed on successful enrollment.

**Verify**: `pnpm --filter @cradle/server test` → all pass

### Step 4: Tests
List/get responses never contain `pairingCode`; create returns it once; expired/consumed pairing code is rejected.

**Verify**: `pnpm --filter @cradle/server test` → all pass

## Done criteria

- [x] `pnpm --filter @cradle/server typecheck` exits 0
- [x] `pnpm --filter @cradle/server test` exits 0; new tests pass
- [x] `grep -rn "pairingCode" apps/server/src/modules/relay-transport/model.ts` shows it only on the explicit pairing-string response (list/get use `pairable`)
- [x] `plans/README.md` status row updated

## STOP conditions

- The web/desktop pairing UI re-fetches the code from the list endpoint (rather than caching the create response) — STOP and report; the client flow must change in lockstep.

## Maintenance notes

- Reviewer: confirm no OpenAPI consumer relied on `pairingCode` in the list response.
- Consider one-time-view semantics server-side (code invalidated after first read).
