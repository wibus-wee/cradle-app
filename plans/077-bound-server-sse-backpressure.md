# Plan 077: Bound every server stream producer behind one backpressure seam

> **Executor instructions**: Follow this plan in order. Keep `Progress`,
> `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`
> current after every stopping point. Run each focused verification before
> continuing. Do not push or open a pull request unless instructed.
>
> **Drift check (run first)**:
> `git diff --stat aec5f553..HEAD -- apps/server/src/infra/sse-event-stream.ts apps/server/src/modules/chat-runtime/stream apps/server/src/modules/chat-runtime/side-chat/live-stream.ts apps/server/src/modules/chat-runtime/es/event-tail.ts apps/server/src/modules/chronicle/index.ts apps/server/src/modules/workspace/service.ts apps/server/src/modules/code-activity/service.ts apps/server/src/modules/download-center/task-events.ts apps/server/src/modules/plugins/index.ts`
> If any of these ownership boundaries changed, reconcile with live code before
> editing. Stop instead of stacking a second buffering abstraction over a newly
> landed replacement.

## Status

- **Execution**: DONE
- **Priority**: P0
- **Effort**: M–L
- **Risk**: MEDIUM
- **Depends on**: none. Composes with Plan 071's snapshot-first recovery
  (overflow-close relies on it for lossless client reconnect) and Plan 054's
  cursor machinery. Does not reopen either plan's lifecycle decisions.
- **Category**: correctness, performance, architecture, tests
- **Planned at**: commit `aec5f553`, 2026-08-22

## Purpose / Big Picture

A heap snapshot of the running Server (`manual-heap-24408-1787385511152`,
2026-08-22) showed ~1.50 GB retained by ~5.2M small (~250–350 B) Uint8Arrays,
held in JS Arrays inside Node webstream queues matching 46 active requests.
Root cause (static analysis, same day): several SSE producers call
`controller.enqueue(...)` unconditionally from event subscriptions. The HTTP
layer is innocent — srvx's `streamBody`
(`srvx/dist/adapters/node.mjs:86-87`) honors `drain`, Elysia's stream wrapper
is pull-based, and two in-repo streams are already correctly bounded. When a
client reads slowly (suspended Electron renderer, background window,
half-open TCP that never fires `close`), those producers fill their
ReadableStream controller queue without limit, multiplied by subscriber
fan-out.

After this plan, every streaming response owned by the server has bounded
buffering regardless of consumer speed: slow clients cause drops or a clean
stream close (recoverable via existing cursor + snapshot reconnect), stalled
consumers are detected and reaped by a watchdog instead of accumulating heap
forever, and backpressure semantics have exactly one owning implementation.

The structural proof: no production `controller.enqueue` inside an event
subscription or interval callback bypasses the shared bounded stream;
overflow and stall closes are observable as payload-free counters; a unit
test drives 100k events into a non-reading reader without unbounded growth.

## Non-goals

- No wire protocol, event schema, or route contract changes.
- No changes to srvx / @elysiajs/node / Elysia adapter layers (verified
  correct; they are dependencies, not our code).
- No DB schema changes.
- No new retry/replay protocol — reuse Plan 054 cursors and Plan 071
  snapshot-first recovery exactly as they are.
- Do not touch `chat-runtime/es/event-tail.ts`'s bounded design except to add
  the shared stall watchdog (Step 2).

## Design

### Ownership of backpressure semantics

One owner: `apps/server/src/infra/sse-event-stream.ts`. It already implements
the right core (bounded `pending`, flush gated on `desiredSize > 0`, flush in
`pull()`, drop-oldest at `maxBufferedEvents`, keepalive only when not full).
Extend it — do not create a second primitive:

1. Add a **byte cap** alongside the event-count cap
   (`maxBufferedBytes`, default e.g. 256 KiB). Drop-oldest until the new
   event fits, then enqueue.
2. Add an **overflow policy**: `'drop-oldest'` (default, current behavior)
   or `'close'`. Under `'close'`, first overflow stops the producer
   subscription, clears pending, closes the controller cleanly. Clients
   recover through existing reconnect/cursor/snapshot paths.
3. Add a **stall watchdog** (both policies): if
   `(controller.desiredSize ?? 0) <= -stallEvents` (default e.g. 32)
   continuously for `stallMs` (default e.g. 30s) while pending is non-empty,
   treat the consumer as dead: cleanup + close. This reaps half-open TCP
   peers whose sockets never fire `close`.
4. Publish payload-free observability counters on overflow-drop,
   overflow-close, and stall-close via the existing observability service
   (same shape discipline as Plan 071: scalars only).

### Producer migration rule

Every site that today runs `setInterval`/subscription callbacks calling
`controller.enqueue` directly must instead own a *subscription → bounded
stream* adapter built on the extended `openSseEventStream`. Producers push
typed events into it; the primitive owns encoding, buffering, flushing,
keepalive, abort, cancel, and the watchdog. Route files keep only HTTP shape.

## Steps

### Step 1 — Extend the shared primitive

`apps/server/src/infra/sse-event-stream.ts`: implement byte cap, overflow
policy, stall watchdog, counters (per options above). Keep the public API
backward-compatible for its current consumers (new options optional).
Update `sse-event-stream.test.ts`: full-pending drop-oldest, byte-cap
eviction, `'close'` policy closes exactly once and unsubscribes, watchdog
closes a stalled consumer and unsubscribes, keepalive suppressed while
pending is non-empty.

### Step 2 — Wire the watchdog into event-tail

`apps/server/src/modules/chat-runtime/es/event-tail.ts` `openTailStream` is
already bounded (`highWaterMark: 0`, event/byte caps, snapshot-required) but
has no stall detection. Add the same watchdog behavior (small local helper
or import from infra if dependency direction allows — `modules/*` may read
`infra`). Its overflow path stays snapshot-required; do not convert it to
`'close'`.

### Step 3 — Migrate chat chunk streams (P0, the leak)

- `apps/server/src/modules/chat-runtime/stream/sse.ts`
  `openBufferedChunkStream`: keep chunk coalescing and replay iteration, but
  replace the raw `chunkStream` + unconditional enqueue with the bounded
  primitive using policy `'close'`. On overflow-close the SSE stream ends;
  web/desktop clients already reconnect and receive a fresh snapshot
  (Plan 071). Remove now-dead buffering code rather than shimming it.
- `apps/server/src/modules/chat-runtime/side-chat/live-stream.ts`: today
  `start()` eagerly `for await`s the entire provider turn and enqueues every
  chunk. Convert consumption to pull-driven (read next provider chunk in
  `pull()` when `desiredSize` allows) so a stalled client stops draining the
  provider iterable instead of queueing the whole turn.
- Update `live-run-streams.ts` docs/comments if overflow-close changes any
  assumption about stream lifetime; verify the interrupted-run and
  orphaned-run paths still terminate the stream deterministically.
- Focused tests: extend `tests/chat-runtime.test.ts` coverage around run
  streams — slow-reader scenario asserting bounded growth and a clean close,
  plus reconnect receiving a correct snapshot after an overflow close.

### Step 4 — Migrate low-rate SSE producers (P1/P2)

Same adapter pattern, policy `'drop-oldest'` (these are state broadcasts;
dropping the oldest is acceptable, and each carries a fresh snapshot via its
own list endpoints):

- `modules/chronicle/index.ts` `/events/stream` (also fixes: its interval
  currently enqueues a keepalive even when the queue is full, and polls the
  DB even when the consumer is gone).
- `modules/workspace/service.ts` workspace file-events stream.
- `modules/code-activity/service.ts` `openSessionEvents`.
- `modules/plugins/index.ts` dev-session events
  (`pluginDevSessions.stream` in dev-session-service) — take the abort
  signal + bounded stream.
- `modules/download-center/task-events.ts` — low frequency; migrate for
  uniformity.

Audit-only (verified correct, no change): `codex/host.ts` pump
(pull-based), `session/index.ts:192` export archive stream (finite),
`chat-runtime/http/introspection.routes.ts` (verify during execution; if it
subscribes unbounded, migrate it too).

### Step 5 — Documentation and ratchet

- Module READMEs for `chat-runtime/stream` and `infra` must state the
  invariant: **production streams may not enqueue outside the bounded
  primitive**; name the primitive as the single owner of backpressure.
- Add a boundary-style grep guard script (alongside
  `scripts/check-module-boundaries.ts`) that fails CI when
  `controller.enqueue(` appears in `apps/server/src/modules/**` outside the
  allowlist (`event-tail.ts`, migrated adapters). This is the ratchet that
  keeps the debt retired.

## Verification

```bash
pnpm --filter @cradle/server typecheck
pnpm --filter @cradle/server check:boundaries
pnpm --filter @cradle/server exec vitest run src/infra/sse-event-stream.test.ts src/modules/chat-runtime/stream --reporter=verbose
pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts --maxWorkers=1 --reporter=dot
pnpm --filter @cradle/server exec vitest run tests/workspace.test.ts tests/chronicle.test.ts tests/download-center 2>/dev/null || true
# scoped per touched module; run the relevant ones
```

Manual smoke (optional, mirrors the original diagnosis): open ≥10 chat
streams against a simulator provider, suspend the renderer windows
(minimize/background throttle), let a long run stream tokens, confirm server
heap stays flat and stalled streams are closed by the watchdog within
`stallMs` slack.

STOP conditions:

- If Elysia's node adapter turns out NOT to propagate `pull()` into wrapped
  ReadableStreams in some path (backpressure break between our stream and
  srvx), stop and fix at that seam instead of tightening producer caps —
  re-verify with a probe test before continuing.
- If `'close'`-policy overflow is observed frequently in practice (> a few
  per day per session), stop and discuss: frequent closes mean the snapshot
  cost dominates and a larger cap or coalescing tuning is needed, not silent
  churn.

## Progress

- [x] (2026-08-22) Step 1: extended shared primitive (byte cap, overflow
  policy, stall watchdog, pressure counters) + tests — `sse-event-stream.test.ts` 7 passing
- [x] (2026-08-22) Step 2: watchdog in event-tail via shared
  `startDeliveryStallWatchdog`; HWM left at 0 to preserve snapshot-required contract
- [x] (2026-08-22) Step 3: `openBufferedChunkStream` rewritten as pull-driven
  bounded stream (`close` policy, force-accepted `[DONE]`, oversized-single-chunk
  exemption); side-chat live-stream converted to pull-driven provider consumption;
  chat-runtime suite 58/58
- [x] (2026-08-22) Step 4: chronicle `/events/stream` (long-lived mode),
  workspace file events, code-activity session events, download-center task
  events migrated onto the primitive; plugins dev-session + introspection
  already used it; codex app-server bridge recorded as known debt
- [x] (2026-08-22) Step 5: module READMEs updated; `check:stream-boundaries`
  ratchet added to typecheck chain (verified failing on a probe violation)

## Surprises & Discoveries

- Observation: the HTTP stack was already correct end-to-end. Evidence:
  srvx's node adapter honors socket drain (`srvx/dist/adapters/node.mjs`
  streamBody), Elysia's stream wrapper is pull-based, and
  `@elysiajs/node` passes streams through as FastResponse bodies. All debt
  lived in app-level producers.
- Observation: `highWaterMark: 0` + producer-side private pending buffers is
  a latent deadlock. With HWM 0, `desiredSize` never exceeds 0, so a chunk
  parked while the consumer sits between reads can never trigger another
  pull — events stall forever. Probe verified Node only re-invokes `pull()`
  on new read requests or controller enqueues. Fixed for
  `openBufferedChunkStream` by switching to default HWM 1 with
  flush-on-push; kept HWM 0 in event-tail (its snapshot-required overflow
  test encodes "nothing delivered before explicit pull") where the stall
  watchdog now reaps the rare parked-reader case.
- Observation: an earlier full `tests/chat-runtime.test.ts` run failed 17/58
  with timeouts across unrelated features (Codex title regen, runtime
  settings, concurrent starts). Every failing test collects SSE responses;
  the single stream deadlock poisoned all of them. After the HWM fix:
  58/58 pass.
- Observation: `chat-runtime-providers/codex/app-server/bridge.ts`
  `openEventStream` wrote SSE frames from notification callbacks without
  bounding — same debt class. Fixed during execution: frames now flow
  through a bounded backlog (128 frames / 1 MiB) with the `close` policy;
  overflow replaces the backlog with an explicit truncation error plus the
  terminal done frame and aborts the host lease so clients can re-invoke.
  A missing `pull()` on the rewritten stream was caught by a flood test
  (overflow fired but parked terminal frames never reached the reader) and
  fixed; bridge suite 7/7 including the new overflow test.

## Decision Log

- Single owner for backpressure semantics (`infra/sse-event-stream.ts`)
  over a new abstraction; event-tail keeps its chat-specific
  snapshot-required semantics.
- Chat run/provider-thread streams use `'close'` overflow, relying on
  Plan 071 snapshot-first reconnect for lossless recovery, rather than
  drop-oldest (which would corrupt message projections).
- Watchdog keyed on delivery progress ("buffered events with no successful
  enqueue for `stallMs`"), not on `desiredSize`: our own bounded buffering
  keeps the controller queue near-empty, so desiredSize never goes deeply
  negative. Not TCP liveness either: half-open connections never fire
  `close`.
- `[DONE]` is force-accepted at terminal time (evicting oldest backlog if
  needed) so a clean terminal always lands even under pressure.
- Ratchet allowlist documents per-file justification; adding a file there
  requires stating why its enqueues cannot accumulate.

## Outcomes & Retrospective

Verification run 2026-08-22: `pnpm --filter @cradle/server typecheck`
(plugin-sdk build + tsc + module boundaries + stream-enqueue boundary),
focused vitest: `src/infra/sse-event-stream.test.ts` (7),
`src/modules/chat-runtime/stream/sse.test.ts` (6),
`src/modules/chat-runtime/es/event-tail.test.ts` (13),
`tests/chat-runtime.test.ts` (58), code-activity/download-center/workspace/
chronicle suites (18), codex provider + app-server suites and the chat
runtime integration file together (294 passed / 1 skipped). No manual heap
smoke performed yet; counters are in place (`sseStreamPressureCounters`)
for runtime confirmation.
