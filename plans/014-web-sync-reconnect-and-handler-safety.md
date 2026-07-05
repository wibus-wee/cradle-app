# Plan 014 — Make SSE/WebSocket handlers crash-safe and reconnect-correct

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/web/src/features/chat/session apps/web/src/features/workspace apps/web/src/features/tui apps/web/src/features/chronicle apps/web/src/lib/sync-socket` — mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — reconnect logic touches all chat/terminal sync transports.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

Two classes of client sync bug: (1) several `onmessage` handlers call `Schema.parse(JSON.parse(...))` with no try/catch, so one malformed or schema-drifted frame throws inside the handler and can freeze that subscription (file tree, download progress, terminal) until remount; (2) the native `EventSource` tail bakes `afterVersion`/`afterSequenceId` into the URL at construction and never rebuilds it, so after an auto-reconnect the browser re-subscribes from the original cursor — if the server doesn't replay, events during the gap are silently dropped and the UI stays stale with no visible degradation. The sync-socket path already refreshes the cursor on resubscribe; the EventSource fallback doesn't.

## Current state

- Uncaught parse in file-tree — `apps/web/src/features/workspace/file-tree.tsx:346-360`:

```346:360:apps/web/src/features/workspace/file-tree.tsx
    const eventSource = new EventSource(buildWorkspaceFileEventsUrl(workspaceId))
    eventSource.onmessage = (event) => {
      const message = WorkspaceFileEventSchema.parse(JSON.parse(event.data))
      if (message.type !== 'directory-changed') {
        return
      }
      ...
    }
    eventSource.onerror = () => {
      // EventSource reconnects automatically.
    }
```

- Same uncaught pattern: `apps/web/src/features/chronicle/use-chronicle.ts:1129-1137` and `apps/web/src/features/tui/pty-channel.ts:124-125,167-168` (per audit — read to confirm).
- Cursor baked into URL, never refreshed on reconnect: `apps/web/src/features/chat/session/session-sync-engine.ts:133-138,226-238` and `apps/web/src/features/workspace/global-session-sync-engine.ts:59-64`. Correct reference: `apps/web/src/lib/sync-socket/client.ts:98-111` (`buildResubFrame` advances cursor on resubscribe).
- Error hooks only log: `apps/web/src/features/chat/session/use-chat-session-driver.ts:107-109`, `apps/web/src/features/workspace/use-global-session-event-sync.ts:52-54`.

## Commands you will need

| Purpose   | Command                          | Expected |
|-----------|----------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Tests     | `pnpm --filter @cradle/web test` | pass     |

## Scope

**In scope**:
- `file-tree.tsx`, `use-chronicle.ts`, `pty-channel.ts` — wrap handler bodies in try/catch; log and drop bad frames (PTY routes through its existing `emitError`).
- `session-sync-engine.ts`, `global-session-sync-engine.ts`, and the EventSource tail transport (`apps/web/src/features/chat/transport/chat-event-tail-transport.ts`) — on error/version advance, close and reopen with the latest cursor, mirroring `sync-socket`'s resubscribe.
- `use-chat-session-driver.ts`, `use-global-session-event-sync.ts` — on `onError`, invalidate the relevant queries and surface a degradation state.
- New/extended tests for the sync engines and pty-channel.

**Out of scope**: server replay semantics (client must not assume replay); the store schema.

## Steps

### Step 1: Crash-safe handlers
Wrap each `onmessage` body in try/catch; on parse failure log once and return (drop the frame). For PTY, route through `emitError`/`onError`.

**Verify**: `pnpm --filter @cradle/web test` → pass

### Step 2: Cursor-correct reconnect
In the EventSource-based engines, when reconnecting (on `error` or when the browser reopens), rebuild the URL with `afterVersion = lastSeenVersion` (and `afterSequenceId` for the global engine). Mirror `buildResubFrame`. If the native EventSource can't be told to reconnect with a new URL, close and construct a new `EventSource`.

**Verify**: `pnpm --filter @cradle/web test` → pass

### Step 3: Surface degradation + catch up
In the driver `onError` hooks, invalidate session snapshot + runtime status queries (and session list for the global engine) and expose a dismissible "connection interrupted, reconnecting" state.

**Verify**: `pnpm --filter @cradle/web test` → pass

### Step 4: Tests
- Sync engine: after a simulated reconnect, the new subscription uses the advanced cursor (not the original).
- Handler: a malformed frame does not throw out of the subscription and subsequent valid frames still process.

**Verify**: `pnpm --filter @cradle/web test` → pass incl. new cases

## Done criteria

- [ ] `pnpm --filter @cradle/web typecheck` exits 0
- [ ] `pnpm --filter @cradle/web test` passes incl. reconnect + malformed-frame tests
- [ ] `plans/README.md` status row updated

## STOP conditions

- The server genuinely replays all missed events on reconnect (making the cursor-refresh unnecessary) — verify against the server tail route; if confirmed, downgrade Step 2 to a snapshot-invalidation on error and report.

## Maintenance notes

- Depends conceptually on plan 013 (so these new tests actually run in CI).
- Reviewer: confirm all four transports (session, global, terminal, chronicle) share consistent reconnect + error-surfacing behavior.
