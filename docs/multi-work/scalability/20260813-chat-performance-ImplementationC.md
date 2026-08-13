# Chat performance implementation C handoff

Completed 2026-08-13 for scalability findings 9, 10, and 11 on branch `agent/perf-thread-search-index`. This change stays within Chat Runtime ownership and intentionally does not include concurrent edits elsewhere in the shared worktree.

## Outcome

Global chat event replay and live fan-out no longer hydrate message bodies merely to strip them. Global replay parses event headers and compact event-owned fields directly. Session replay collects message payload references and completed-message ids from the bounded event page, then performs one payload query and one structural-message query for the entire page. A focused four-event test asserts the constant three-read shape: event page, payload batch, and structural batch.

Each SSE event-tail client now owns a queue capped at 128 events and 1 MiB. The `ReadableStream` uses a zero high-water mark so browser/runtime buffering cannot grow independently of that queue. `pull()` releases one queued chunk at a time. On count or byte overflow, the stream discards the incomplete backlog, unsubscribes from live publication, replaces the backlog with exactly one `SnapshotRequired` event carrying the latest observed version and sequence id, delivers that terminal handoff, and closes. Initial replay-gap `SnapshotRequired` responses are terminal under the same behavior. Keepalives are skipped while event data is pending and never accumulate.

Message history no longer reads, parses, and reduces every event header. It reads the revision with the existing indexed `session_events (aggregate_id, version)` latest-version query and uses the transactionally maintained `messages.status` projection for each bounded page row. No schema or migration change was required.

## Owned files

- `apps/server/src/modules/chat-runtime/es/event-tail.ts`
- `apps/server/src/modules/chat-runtime/es/event-tail.test.ts`
- `apps/server/src/modules/chat-runtime/history-api.ts`
- `apps/server/src/modules/chat-runtime/history-api.performance.test.ts`
- `apps/server/src/modules/chat-runtime/message-payload-store.ts`

The nearby modification to `apps/server/src/modules/chat-runtime/pending-tool-approval.ts` belongs to another concurrent task and is not part of this implementation or commit.

## Behavioral evidence

The global header-only test stores a v4 message event whose payload reference does not exist. Global replay still returns the compact `{ messageId }` event, proving it does not access `chat_message_payloads`. A second live-fan-out test uses invalid structural message JSON and proves a global-only subscriber does not parse it.

The scoped hydration test stores two user message events and two assistant completion events. All four contain snapshots after replay, while a spy on the Drizzle `select` seam observes exactly three reads total rather than one or more reads per event.

The slow-reader test publishes 129 events without pulling from a stream whose event limit is 128. The first readable item is the terminal `SnapshotRequired` event with version and sequence 129, the next read is done, and the producer unsubscribe callback has run. Existing replay, catch-up race, live fan-out, workspace filtering, and cancellation coverage remains green.

The history test places a malformed old event payload before a valid latest event. A history snapshot returns revision 2000 and an empty bounded page without parsing the malformed historical payload, which would have failed under the prior full-header reduction.

## Validation

Run from the repository root:

    XDG_DATA_HOME=/tmp/cradle-xdg PNPM_HOME=/tmp/cradle-pnpm-home COREPACK_HOME=/tmp/cradle-corepack corepack pnpm exec eslint apps/server/src/modules/chat-runtime/es/event-tail.ts apps/server/src/modules/chat-runtime/es/event-tail.test.ts apps/server/src/modules/chat-runtime/history-api.ts apps/server/src/modules/chat-runtime/history-api.performance.test.ts apps/server/src/modules/chat-runtime/message-payload-store.ts

Result: passed with no diagnostics.

    XDG_DATA_HOME=/tmp/cradle-xdg PNPM_HOME=/tmp/cradle-pnpm-home COREPACK_HOME=/tmp/cradle-corepack corepack pnpm --dir apps/server exec vitest run src/modules/chat-runtime/es/event-tail.test.ts src/modules/chat-runtime/history-api.performance.test.ts

Result: 2 files passed, 14 tests passed.

    XDG_DATA_HOME=/tmp/cradle-xdg PNPM_HOME=/tmp/cradle-pnpm-home COREPACK_HOME=/tmp/cradle-corepack corepack pnpm --dir apps/server exec vitest run src/modules/chat-runtime/stream/checkpoint-store.test.ts src/modules/chat-runtime/index.routes.test.ts

Result: 2 files passed, 11 tests passed.

    node --import tsx apps/server/scripts/check-module-boundaries.ts

Result: passed; largest runtime-domain strongly connected component remains 23.

    XDG_DATA_HOME=/tmp/cradle-xdg PNPM_HOME=/tmp/cradle-pnpm-home COREPACK_HOME=/tmp/cradle-corepack corepack pnpm --filter @cradle/server exec tsc --noEmit --pretty false

The compiler reported only concurrent Work/Session pagination test errors in `session/service.test.ts` and `work/service.test.ts`. It reported no diagnostics in the owned Chat Runtime files. The normal boundary script wrapper also cannot open its `tsx` IPC socket in this sandbox (`EPERM`), so the same script was run successfully through `node --import tsx` as shown above.

`git diff --check` passed for every owned source, test, and handoff file.

## Recovery and follow-up

The change is read-only with respect to durable data and has no migration. Reverting the owned commit restores the previous hydration and stream behavior. Clients already handle `SnapshotRequired` by refreshing authoritative state, so no generated contract or client change is required. If the queue limits need operational tuning later, keep both count and byte caps and retain the terminal latest-cursor contract; increasing only the count can reintroduce large-message memory growth.
