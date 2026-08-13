# Infrastructure performance implementation F handoff

Completed 2026-08-13 for scalability findings 7, 16, 18, 20, 21, and 22. The implementation covers desktop IPC diagnostics, notification delivery, browser annotation scanning, relay synchronization and queue retention, and simulator schema compilation. It intentionally excludes Work/Session, CI, lazy loading and React Compiler configuration, Streamdown, and CLI files.

## Outcome

IPC devtool handlers remain registered for the application lifetime, but the expensive main-process observer is attached only while at least one IPC devtool WebContents subscriber exists. Subscriber destruction, send failure, and explicit unsubscribe all update the count and detach the observer at zero. Diagnostic serialization first creates a bounded preview: at most 50 entries per container, 250 visited objects, depth 5, and 2,048 characters per string. Arrays, typed views, cycles, errors, and hostile reflective objects are bounded or degraded safely before SuperJSON serialization. This avoids traversing and serializing complete IPC payload graphs when diagnostics are active, while the absent observer remains a no-op before serialization.

Desktop notifications now subscribe to the existing durable global chat event broker rather than making a request every three seconds. Startup performs one authoritative refresh. Run terminal, interaction lifecycle, and snapshot-required facts coalesce into event-driven refreshes. Closed or failed tails reconnect from the latest observed sequence id after a bounded delay. The review fixed a race in the initial implementation: an event whose 50 ms refresh fired while a previous poll was still running was silently discarded. A pending-refresh latch now schedules one follow-up read after the in-flight read settles. The broker exposes an internal listener seam that shares existing global upstreams and aborts an upstream when its last internal/renderer observer leaves.

Browser annotation scanning samples viewport hit stacks first, then uses a TreeWalker that rejects ignored subtrees before layout/style reads and stops at the 250-result budget. Stable selector and role metadata is cached in a WeakMap and invalidated on page mutations. Annotation overlay mutations are excluded from invalidation so the overlay does not continuously clear its own cache.

Relay peer lookup now uses `RWMutex.RLock` for read-only forwarding instead of serializing all forwards behind the hub’s exclusive lock. The peer scheduler clears a dequeued data envelope before reslicing, matching the existing control-queue behavior and releasing referenced frame buffers promptly.

The model API simulator caches dynamically compiled OpenAI validators in a WeakMap keyed by the immutable schema object identity. Repeated validation of the same operation/status schema reuses one AJV validator while error labels remain call-specific.

## Owned files

- `apps/desktop/src/main/chat-event-tail-broker.ts`
- `apps/desktop/src/main/chat-event-tail-broker.test.ts`
- `apps/desktop/src/main/ipc-devtool-store.ts`
- `apps/desktop/src/main/ipc-devtool-store.test.ts`
- `apps/desktop/src/main/ipc-devtool.ts`
- `apps/desktop/src/main/main-app.ts`
- `apps/desktop/src/main/notification-center-manager.ts`
- `apps/desktop/src/main/notification-center-manager.test.ts`
- `apps/desktop/src/preload/browser-annotation-runtime.ts`
- `apps/relayd/internal/relay/hub.go`
- `apps/relayd/internal/relay/hub_test.go`
- `packages/ipc/src/events.ts`
- `packages/ipc/src/events.test.ts`
- `packages/model-api-simulator/src/core/json-schema-registry.ts`
- `packages/model-api-simulator/tests/protocol-artifacts.test.ts`

The concurrent `apps/desktop/electron.vite.config.ts` React Compiler exclusion is a lazy-load/build concern and is intentionally excluded from this implementation commit.

## Validation

Run from the repository root:

    XDG_DATA_HOME=/tmp/cradle-xdg PNPM_HOME=/tmp/cradle-pnpm-home COREPACK_HOME=/tmp/cradle-corepack corepack pnpm vitest run apps/desktop/src/main/chat-event-tail-broker.test.ts apps/desktop/src/main/ipc-devtool-store.test.ts apps/desktop/src/main/notification-center-manager.test.ts packages/ipc/src/events.test.ts

Result after review fixes: 4 files passed, 19 tests passed. Coverage includes observer activation/deactivation, bounded/cyclic/hostile diagnostics, internal event-tail lifecycle, zero idle notification polling, relevant-event refresh, and the in-flight refresh race.

    XDG_DATA_HOME=/tmp/cradle-xdg PNPM_HOME=/tmp/cradle-pnpm-home COREPACK_HOME=/tmp/cradle-corepack corepack pnpm --filter @cradle/desktop typecheck

Result: passed, including the plugin SDK prerequisite build and desktop Node TypeScript project.

    XDG_DATA_HOME=/tmp/cradle-xdg PNPM_HOME=/tmp/cradle-pnpm-home COREPACK_HOME=/tmp/cradle-corepack corepack pnpm --filter @cradle/model-api-simulator typecheck
    XDG_DATA_HOME=/tmp/cradle-xdg PNPM_HOME=/tmp/cradle-pnpm-home COREPACK_HOME=/tmp/cradle-corepack corepack pnpm --filter @cradle/model-api-simulator test

Result: both simulator TypeScript projects passed; 13 files and 49 tests passed. The dynamic-schema test observes one AJV compile for two validations of the same schema identity.

Focused ESLint and `git diff --check` passed for the owned TypeScript, test, Go, and handoff files.

Neither `go` nor `cargo` is installed in this workspace. Relay `go test ./internal/relay`, `go test -race ./internal/relay`, and any Cargo validation could not be run. The relay changes were reviewed manually for lock pairing and queue accounting; they still require Go test and race-detector execution in CI or a Go-enabled checkout.

## Recovery

There are no durable schema changes. Reverting the implementation commit restores the previous observer, polling, scan, lock, queue, and validator behavior. Notification cursors are in-memory and reconnect safely from zero after process restart; the authoritative startup refresh covers the restart gap. Browser metadata is a disposable WeakMap. Simulator validators are weakly keyed and can be reclaimed with their schema objects.
