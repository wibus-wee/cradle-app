# Plan 022 — Characterization tests for untested web critical paths

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/web/src/features/chronicle apps/web/src/features/chat/session apps/web/src/features/tui apps/web/src/lib/sync-socket apps/web/src/features/workspace/file-tree.tsx` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW — adding tests; may surface latent bugs (good).
- **Depends on**: plans/013-root-test-includes-web.md (so these run in the main suite)
- **Category**: tests
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

The highest-churn, highest-risk client paths have zero tests: the chronicle feature (~1511-line hook + SSE + schemas), the chat session driver (7 coordinated effects: hydrate, sync, snapshot, reconcile, passive stream), the terminal PTY channel and shared sync-socket client (reconnect/cursor logic), and the workspace file-tree live sync. These are exactly the areas plans 014/017 modify — without a test net those refactors are blind. This plan adds characterization tests that lock in current behavior first.

## Current state

- `apps/web/src/features/chronicle/use-chronicle.ts` (~1511 lines) — no `use-chronicle*.test.*` exists.
- `apps/web/src/features/chat/session/use-chat-session-driver.ts` — no driver test; `session-sync-engine.test.ts` covers only the engine class.
- `apps/web/src/features/tui/pty-channel.ts`, `apps/web/src/lib/sync-socket/client.ts` — no tests (only `terminal-panel-store.test.ts` for store CRUD).
- `apps/web/src/features/workspace/file-tree.tsx:341-364` — EventSource live sync, no test.
- Test runner: vitest + jsdom (`apps/web/package.json:11`). Follow an existing web test as the structural pattern (e.g. `apps/web/src/features/git/changes-panel.test.ts`).

## Commands you will need

| Purpose   | Command                          | Expected |
|-----------|----------------------------------|----------|
| Web tests | `pnpm --filter @cradle/web test` | pass     |

## Scope

**In scope** (create):
- `features/chronicle/use-chronicle.test.ts` (or split) — Zod message schemas, download-progress reducer/eviction, one mutation invalidation path.
- `features/chat/session/use-chat-session-driver.test.ts` — cache hit, snapshot success, snapshot error, disabled/unmount cleanup, passive-stream projection.
- `features/tui/pty-channel.test.ts` — reconnect, malformed frame handling, pending queue.
- `lib/sync-socket/client.test.ts` — resubscribe cursor advancement.
- `features/workspace/file-tree.test.ts` — valid/invalid event payloads, reload only for loaded paths, cleanup closes EventSource.

**Out of scope**: fixing bugs these tests reveal — if a test documents current (buggy) behavior, note it and cross-reference the relevant fix plan (014/017) rather than fixing here.

## Steps

### Step 1: Chronicle schema + reducer tests
Mock fetch/EventSource; assert schema transforms and download-progress map behavior.

**Verify**: `pnpm --filter @cradle/web test chronicle` → pass

### Step 2: Chat session driver tests
Use a mocked QueryClient, store, and a fake sync engine; assert the five behaviors listed.

**Verify**: `pnpm --filter @cradle/web test use-chat-session-driver` → pass

### Step 3: PTY + sync-socket tests
Fake WebSocket; assert reconnect, cursor advancement on resubscribe, malformed-frame handling.

**Verify**: `pnpm --filter @cradle/web test pty-channel` and `... sync-socket` → pass

### Step 4: File-tree live-sync test
Fake EventSource; assert reload gating and cleanup.

**Verify**: `pnpm --filter @cradle/web test file-tree` → pass

## Done criteria

- [ ] `pnpm --filter @cradle/web test` passes with the new test files present
- [ ] Each of the five target areas has at least the listed cases
- [ ] Any current-behavior bug documented by a test is cross-referenced to plan 014/017
- [ ] `plans/README.md` status row updated

## STOP conditions

- A target's dependencies can't be mocked without large refactors — STOP and report; that itself is a testability finding to plan separately.

## Maintenance notes

- Best sequenced BEFORE plans 014/017/020 touch these files, so those changes have a safety net.
- Reviewer: reject tests that assert nothing meaningful or just mirror the implementation.
