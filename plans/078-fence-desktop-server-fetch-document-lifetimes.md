# Plan 078: Fence Desktop Server fetches to renderer document lifetimes

> **Executor instructions**: Follow this plan in order. Keep `Progress`,
> `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`
> current at every stopping point. Run each focused verification before
> continuing. Do not push or open a pull request unless instructed.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat cf1fdb87..HEAD -- \
>   apps/desktop/src/main/server-fetch-broker.ts \
>   apps/desktop/src/main/server-fetch-broker.test.ts \
>   apps/desktop/src/shared/server-fetch-transport.ts \
>   apps/web/src/lib/server-transport/desktop-ipc-fetch.ts \
>   apps/web/src/lib/server-transport/fetch-event-source.ts \
>   apps/web/src/lib/server-transport/fetch-event-source.test.ts \
>   apps/web/src/lib/plugin-host.ts \
>   apps/web/src/main.tsx \
>   apps/server/src/http/upstream.ts \
>   apps/server/src/modules/relay-transport/controller-transport.ts \
>   apps/server/src/modules/relay-transport/node-connector.ts
> ```
>
> Reconcile any changed ownership or lifecycle behavior with live code before
> editing. Stop if Plan 075's Main-owned broker or receiver-credit protocol has
> been replaced; do not layer this fix over a different transport architecture.

## Status

- **Execution**: IN PROGRESS (implementation, focused gates, and isolated
  Electron reload proof complete; real-process recovery observation pending)
- **Priority**: P0
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: the implemented Main broker and pull-credit baseline from
  Plan 075. This plan blocks calling Plan 075 lifecycle-complete; it does not
  depend on Plan 075's still-pending packaged multi-window CI result.
- **Category**: correctness, performance, lifecycle, diagnostics, tests
- **Planned at**: commit `cf1fdb87`, 2026-08-29

## Purpose / Big Picture

Reloading or replacing the Web renderer document currently abandons Fetch
responses and SSE readers without destroying their Electron `WebContents`.
`DesktopServerFetchBroker` owns requests only by `webContents.id` and listens
only for `destroyed`, so the old requests survive. Receiver credit eventually
reaches zero, which correctly stops broker reads but does not cancel the
upstream Undici request. The local Server keeps serializing/writing into sockets
whose consumer is no longer making progress. Linked sessions amplify the same
failure through Fabric and another localhost Server socket.

After this plan, a Desktop Server request belongs to one renderer **document**,
not merely to a window. A main-frame cross-document navigation, renderer crash,
explicit abort, body cancel, Server generation change, consumer-idle expiry, or
Desktop shutdown all converge on the broker's one idempotent cancellation path.
The cancellation releases the Web reader, Main Undici request, local Server
socket, and any Fabric stream downstream of it. Diagnostics make stale ownership
visible before memory pressure becomes the first alert.

The target invariant is:

```text
renderer document ends or body loses its consumer
  -> Main broker removes ownership synchronously
  -> AbortController abort + reader.cancel()
  -> localhost request signal/socket closes
  -> Fabric stream close (when present)
  -> Node connector destroys its localhost Server socket
  -> Server WriteWrap completes or fails; serialized bytes become collectible
```

This is an incident-remediation plan, not a transport redesign. Keep localhost
HTTP, the two Undici pools, the existing IPC protocol, and Plan 077's bounded
Server-side SSE producers.

### Ownership map

| Owner | Current responsibility | Plan 078 responsibility |
| --- | --- | --- |
| [Main fetch broker](../apps/desktop/src/main/server-fetch-broker.ts) | Owns Undici requests, readers, credit, and cancellation for a `WebContents`. | Make ownership document-aware; add the body lease and diagnostics. |
| [Desktop Fetch adapter](../apps/web/src/lib/server-transport/desktop-ipc-fetch.ts) | Reconstructs Fetch responses and grants pull credit. | Cancel its complete pre/post-header registry on page and HMR disposal. |
| [Fetch SSE adapter](../apps/web/src/lib/server-transport/fetch-event-source.ts) | Parses and reconnects Server event streams. | Cancel and release each reader on every terminal path. |
| [Web bootstrap](../apps/web/src/main.tsx) and [plugin host](../apps/web/src/lib/plugin-host.ts) | Start the plugin development watcher. | Retain and execute the returned watcher cleanup exactly once. |
| [Server upstream proxy](../apps/server/src/http/upstream.ts) | Passes the inbound request signal and upstream response body through. | Characterize cancellation; change only if the test finds a broken edge. |
| [Fabric controller transport](../apps/server/src/modules/relay-transport/controller-transport.ts) and [node connector](../apps/server/src/modules/relay-transport/node-connector.ts) | Propagate stream close and destroy their local sockets. | Characterize end-to-end close propagation; preserve the protocol when it passes. |

[Plan 075](./075-eliminate-desktop-long-stream-pool-starvation.md) owns the
Main transport architecture. [Plan 077](./077-bound-server-sse-backpressure.md)
owns producer-side Server stream bounds. This plan owns the missing consumer
document lifetime between them.

## Incident Record

### Live snapshot: 2026-08-29

The current process was inspected read-only through its already-enabled Node and
Electron inspector endpoints plus process/socket diagnostics. Counts changed
slightly while the app continued running; the later internally consistent
snapshot is recorded here.

| Surface | Observed state |
| --- | ---: |
| Server active requests | 93, all `WriteWrap` |
| Bytes retained by those pending writes | 174,028,273 B (165.97 MiB) |
| Pending write chunks | 4,720 |
| Writes larger than 1 MiB | 10 |
| Writes smaller than 64 KiB | 83 |
| Server `arrayBuffers` | 204,168,387 B (194.71 MiB) |
| Pending writes / `arrayBuffers` | 85.2% |
| Main broker requests | 69 (66 stream, 3 finite) |
| Main broker renderer owners | 1 |
| Server Socket handles | 242 |

The earlier snapshot in the same incident contained 92 `WriteWrap`s,
174,019,377 pending bytes, 4,456 chunks, 241 sockets, and about 202.27 MiB of
Server ArrayBuffer. The increase while the process stayed live is itself
consistent with requests being retained rather than drained.

The ten large pending writes account for nearly the complete byte total:

| Request family | Copies | Pending bytes |
| --- | ---: | ---: |
| Same `/messages?limit=100` response for session `37547...` | 3 | 100,294,033 |
| Other large message responses and one Fabric response | 7 | 73,734,240 |

This does **not** mean chat history is stored three times in the database. The
same class of complete JSON response was serialized and sent repeatedly, then
retained by separate abandoned writes. `history.routes.ts` returning one full
`Response.json(await getMessageSnapshot(...))` is a severity multiplier; it is
not the lifetime root cause.

Socket classification corroborated the ownership chain:

- 75 inbound localhost requests came through Fabric and 70 were direct.
- The same workspace file-event SSE had 68 subscribers, 62 through Fabric.
- `/plugins/dev-sessions/events` had 23 subscribers.
- `/download-center/events` had 22 subscribers.
- Main reported one renderer owner while retaining 69 requests.

Those endpoints normally have a small number of subscriptions per live owner.
The observed fan-out cannot be explained by one live document's intended state.

### Historical memory telemetry

For the approximately 49-hour process cycle, Grafana recorded Server RSS at
1.69 GiB peak, Server external memory at 356 MiB, Server ArrayBuffer at 352 MiB,
Renderer JS heap at 1.79 GiB, tab working set at 3.86 GiB, and browser working
set at 1.25 GiB. Seven-day peaks were 2.37 GiB Server RSS, about 1.79 GiB each
for Server external/ArrayBuffer, 1.99 GiB Renderer heap, and 3.96 GiB tab working
set.

Across roughly 2,999 samples over 50 hours, Server external and ArrayBuffer
levels correlated at `r = 0.9993`; their differences correlated at `r = 0.9823`.
The observability queue stayed at zero during the relevant window. The main
change point was 2026-08-28 12:50-13:00 UTC: adjacent ten-minute external-memory
means increased by about 91 MiB while handles rose from about 102 to 220. Active
requests rose by another approximately 54 during 2026-08-29 06:10-06:20 UTC.

The short external-memory peak near 2026-08-29 12:46 UTC included inspector
materialization of a large diagnostic result and is excluded from the causal
claim.

Current `vmmap` reported approximately 2.1 GiB Renderer footprint, 1.1 GiB
Server, 676 MiB GPU, and 411 MiB Electron Main. Historical peaks are not
simultaneous and must not be added. System swap was 11.58 GiB used, including
about 1.3 GiB Renderer and 592 MiB Server pages; a restart can release leaked
objects but does not immediately erase historical swap pressure.

### Confidence boundaries

**Proven from live objects and code:**

- Server external growth in the incident is overwhelmingly ArrayBuffer growth,
  and most current ArrayBuffer bytes are directly accounted for by pending Node
  writes.
- The Main broker retains 69 requests for one `WebContents`; credit zero pauses
  `pump()` without removing an `ActiveRequest`.
- broker owner cleanup listens only to `WebContents.destroyed`, not navigation,
  reload, or `render-process-gone`.
- Fabric already has explicit stream-close propagation in both directions:
  controller local-socket close calls `session.closeStream`; node
  `onStreamClose` destroys its localhost socket; proxy fetch uses
  `request.signal`.
- `main.tsx` discards the cleanup returned by
  `startPluginDevSessionWatcher()`.
- `FetchEventSource.connect()` does not cancel/release its reader in `finally`.

**Strongly supported, to lock down with tests before edits:**

- Main-frame reload is the first broken lifecycle boundary. Because Main never
  closes the localhost consumer socket, Fabric has no close to propagate.
- Cancelling the broker request will tear down direct and Fabric-backed Server
  writes. Step 1 must prove this with controlled sockets rather than assuming
  the framework adapter behavior.

**Not proven and not a basis for this P0 change:**

- A database engine leak. No evidence points to database-owned retention.
- That all Renderer live heap is unrelated to chat. Raw chat strings and DOM
  nodes do not explain the full heap, but derived React/client/store objects need
  a retainer snapshot before attribution.
- A broken Fabric close protocol. Do not modify the protocol unless the Step 1
  characterization test fails.

## Scope

### In scope

- Main-owned renderer document/navigation lifecycle for every broker request.
- A bounded no-credit body lease as defense in depth for consumers abandoned
  without navigation.
- Payload-free broker diagnostics for endpoint, age, lifecycle state, credit,
  declared/delivered/buffered bytes, and cancellation reason.
- Renderer page lifecycle/HMR cancellation of every pending Desktop IPC fetch.
- Deterministic SSE reader cancel/release and plugin watcher disposal.
- Direct and Fabric cancellation characterization plus repeated-reload stress.

### Out of scope

- DB schema or chat persistence changes.
- Pagination/redesign of `/messages?limit=100`; record it as a follow-up payload
  amplifier after cancellation is fixed.
- Fabric protocol or proxy changes unless a focused propagation test proves the
  existing close chain fails.
- Plan 077's Server stream-buffering primitive; it is DONE and addresses a
  different producer-side queue.
- Renderer performance-monitor cleanup, User Timing churn, React allocation
  churn, or a full Renderer heap snapshot. Track those separately after memory
  pressure is stable.
- Restarting the app as a fix. Restart is valid incident recovery only after the
  code fix is ready or the operator explicitly accepts recurrence.

## Design Decisions

### Main is the authoritative lifetime owner

`DesktopServerFetchBroker` already owns upstream AbortControllers and readers,
so it remains the single cancellation authority. Extend each per-`WebContents`
registration with typed Electron listeners for:

- `destroyed`;
- `render-process-gone`;
- `did-start-navigation` when the navigation is main-frame and not same-document.

Use the Electron 42 type overload present at implementation time; do not copy an
older positional event signature. Hash/in-page navigation must not cancel API
work. On a qualifying event, synchronously `take()` every request before awaiting
reader cancellation so stale completions cannot send into the next document.

Main navigation alone cannot reject an `open` IPC message already queued by the
discarded realm after the navigation event. Preload therefore creates a random
document nonce, registers it with Main, and injects it into every `open`; Web
application code cannot choose it. Main accepts only the current main frame and
nonce, retires the previous nonce on navigation, and rejects late opens from a
retired document. Keep one listener set and the retired-nonce fence for the
`WebContents` lifetime, then remove them on `destroyed` or broker shutdown.

The renderer cleanup is a helpful fast path, not authority: page teardown and
HMR disposal are not guaranteed to finish under crash or forced navigation.

### Zero-credit is a bounded body lease

Receiver credit remains the backpressure mechanism. Add an injected
`consumerIdleMs` broker option for fake-timer tests and one documented production
constant. The initial production policy is 60 seconds at zero credit **after a
response body reader exists**:

- clear the timer while credit is positive or a credited read is outstanding;
- start/reset it when a delivered chunk consumes the last credit, and when a
  response body first becomes ready with no credit;
- expiry uses the same idempotent cancellation path with reason
  `consumer-idle`;
- timers are cleared on every terminal path and `unref()` where available.

Before enabling the default, inventory first-party finite-response callers and
prove they begin consuming or cancel within the lease. If any supported caller
intentionally holds a response body unread for 60 seconds, STOP and define an
explicit per-request lease contract in the shared IPC request instead of silently
changing Fetch semantics. Do not tune the value from one incident sample.

An SSE reader waiting for the next event remains healthy: its outstanding
`read()` causes `ReadableStream.pull()` to grant credit, so its broker credit is
positive while upstream is quiet. The timeout targets a consumer that stopped
asking for another chunk, not an idle endpoint.

### Diagnostics distinguish measured bytes from inferred bytes

For each active request record:

- method, response kind, pathname with query values omitted;
- opened time, response-head time, last-credit time, last-delivery time;
- current credit and state (`opening`, `reading`, `waiting-credit`);
- `Content-Length` when valid, delivered bytes, and broker remainder bytes;
- owner id, owner lifecycle generation, and final cancellation reason.

Expose bounded aggregates plus at most the 20 oldest/largest active entries.
Never emit request/response bodies, headers, auth, or query values. A pathname
may contain an operational entity id, so keep the detailed list in local runtime
diagnostics rather than metric labels or third-party high-cardinality events.

Do not call `process._getActiveRequests()` in production. Broker remainder bytes
and declared-minus-delivered bytes are not Node `WriteWrap.pendingBytes`; name
them accurately. Preserve the inspector probe only as an incident runbook tool
if one is later documented.

## Steps

### Step 1 - Add failing cancellation characterization tests

Extend `apps/desktop/src/main/server-fetch-broker.test.ts` with a reusable
EventEmitter-backed fake `WebContents` and controlled HTTP bodies. Lock in the
current failure before changing production code:

1. Open both finite and SSE responses, consume enough credit to reach zero,
   emit a main-frame cross-document navigation, and assert upstream abort/body
   cancel plus zero broker requests without destroying `WebContents`.
2. Assert same-document/in-page navigation does not cancel.
3. Assert `render-process-gone` cancels all requests.
4. Start a new request after the navigation event and prove completion from the
   old request cannot cancel or send terminal events for the new document.
5. Through a real localhost fixture, cancel after response headers and assert
   the Server-side request/socket observes close within one second.

Add `apps/server/src/http/upstream.cancellation.test.ts` plus the smallest relay
transport integration fixture needed to characterize the real chain: closing
the originating localhost client socket must make the Server adapter abort the
inbound `request.signal`; the proxy fetch/body must then close the
controller-side local socket, emit stream close, and destroy the node
connector's localhost socket. Do not assert that cancelling an arbitrary
`Response.body` directly mutates an inbound `Request.signal`; that relationship
belongs to the HTTP adapter and client socket. If the end-to-end chain passes,
make no production Fabric change. If it fails, STOP and record the exact first
broken edge before expanding this plan's scope.

### Step 2 - Make broker ownership document-aware

Update `server-fetch-broker.ts` owner registration and teardown per the Main
ownership design above. Route `destroyed`, main-frame cross-document navigation,
renderer crash, explicit IPC cancel, Server-generation replacement, upstream
failure, normal EOF, and broker shutdown through one idempotent terminal helper
with a typed reason.

Tests must assert listener cardinality and cleanup as well as request counts:
many requests in one document attach one listener set; it survives an empty
request set so late retired-document opens remain fenced; `destroyed` and broker
shutdown remove it. Repeated events/cancel are harmless, and no terminal IPC send
targets a destroyed or superseded document.

The navigation test and real Electron smoke exposed a late-old-realm `open`
race. Use the preload-owned nonce described above; do not accept a document id
from Web application code as authority.

### Step 3 - Reap no-credit consumers and publish diagnostics

Add the body lease and fields described under Design Decisions. Use fake timers
to prove:

- zero-credit finite and SSE bodies cancel after the lease;
- positive/outstanding credit never expires merely because an endpoint is quiet;
- consuming the last credit starts exactly one timer;
- new credit clears it and later zero credit starts a fresh lease;
- all finish/fail/cancel/navigation/shutdown paths clear the timer;
- diagnostics omit query values and payloads, cap the detail list, and report
  byte fields with their exact semantics.

Update the existing runtime snapshot consumer only as required by the typed
diagnostic shape. Avoid new metrics with endpoint IDs as labels.

### Step 4 - Close renderer-owned resources deterministically

In `desktop-ipc-fetch.ts`, keep a registry covering requests before headers and
response bodies after headers. Add one idempotent `cancelAll` operation that
sends bridge cancel, removes AbortSignal listeners, errors live stream
controllers where appropriate, and clears the registry. Invoke it on `pagehide`
and `import.meta.hot.dispose`; `resetDesktopIpcFetchForTests()` must use the same
cleanup path. Do not rely on `FinalizationRegistry` or garbage-collection timing.

In `fetch-event-source.ts`, hold the current reader and always cancel/release it
in `finally` on close, abort, parse error, failed reconnect, and natural EOF.
Ensure one failed connection cannot race a newer reconnect or schedule another
retry after `close()`.

In `main.tsx`, retain the cleanup returned by
`startPluginDevSessionWatcher()` and invoke it once on page/HMR disposal. Prefer
one bootstrap-owned disposer registry if the existing startup concerns need a
shared owner; do not add scattered duplicate global listeners.

Focused Web tests must cover pagehide/HMR cancellation before and after response
headers, SSE cancel/release on every terminal path, no reconnect after close,
and exactly-once plugin watcher disposal.

### Step 5 - Prove repeated reloads return to baseline

Extend or recreate the isolated Electron broker smoke described by Plan 075.
Use a fake Server with one multi-megabyte finite response and representative
workspace/plugin/download SSE endpoints. Reload the same `BrowserWindow` ten
times without destroying its `WebContents`.

After each navigation, within one second:

- old-document broker request count is zero;
- fake Server direct sockets return to the new document's expected baseline;
- response writes from the old document observe close;
- Fabric characterization, when enabled, has no old stream or node-local socket;
- the new document can fetch normally.

After ten iterations, request/socket counts must be constant rather than linear,
and broker diagnostic declared-undelivered bytes for old documents must be zero.
Keep the fixture payload bounded enough for CI; this test validates lifetime, not
OOM behavior.

### Step 6 - Runtime acceptance and incident recovery

After focused tests and packaged smoke pass, run a controlled development build
against a disposable workspace/session:

1. Record broker diagnostics, Server active requests/handles, external, and
   ArrayBuffer baseline.
2. Perform ten full reloads and at least one HMR replacement while the finite
   response and three SSE families are active.
3. Wait one body lease plus ten seconds.
4. Confirm broker active requests and Server sockets returned to the live
   document baseline; no old endpoint age exceeds the lease.
5. Confirm Server external/ArrayBuffer no longer grows stepwise with reloads.

Only then restart the real app once to release objects and swap pages retained by
the pre-fix process. Compare post-restart counts to the controlled baseline. Do
not claim swap usage itself will drop immediately.

## Verification

Run focused checks from the repository root; adapt exact Web test paths to the
tests added in Steps 3-4.

```bash
node_modules/.bin/vitest run \
  apps/desktop/src/main/server-fetch-broker.test.ts \
  apps/desktop/src/preload/server-fetch.test.ts

node_modules/.bin/vitest run --config apps/web/vitest.transport.config.ts \
  apps/web/src/lib/server-credential.test.ts \
  apps/web/src/lib/server-transport/fetch-event-source.test.ts \
  apps/web/src/lib/bootstrap-disposer.test.ts \
  apps/web/src/lib/plugin-host.test.ts

pnpm --filter @cradle/server exec vitest run \
  src/http/upstream.cancellation.test.ts \
  tests/relay-transport/session.test.ts --reporter=verbose

pnpm --filter @cradle/desktop smoke:server-fetch-lifecycle

node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json
node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json
pnpm --filter @cradle/server typecheck

node_modules/.bin/eslint \
  apps/desktop/src/main/server-fetch-broker.ts \
  apps/desktop/src/main/server-fetch-broker.test.ts \
  apps/desktop/src/shared/server-fetch-transport.ts \
  apps/web/src/lib/server-transport/desktop-ipc-fetch.ts \
  apps/web/src/lib/server-transport/fetch-event-source.ts \
  apps/web/src/main.tsx

(cd apps/desktop && node_modules/.bin/electron-vite build)
git diff --check
```

Do not run the full repository test suite. If an exact listed test file does not
exist at execution time, place coverage next to the production owner and update
this living plan with the actual command rather than using `|| true`.

## Done When

- Main-frame reload/navigation and `render-process-gone` release every request
  owned by the prior document without destroying `WebContents`.
- Zero-credit bodies are cancelled within the documented lease, while healthy
  quiet SSE with outstanding credit stays open.
- Direct and Fabric cancellation tests identify no broken downstream edge; any
  discovered broken edge is fixed at its owner with a regression test.
- Renderer pagehide/HMR, Fetch response cancel, AbortSignal, SSE finalization,
  and plugin watcher cleanup all converge on broker cancellation.
- Ten same-window reloads leave broker requests, Server sockets, Fabric streams,
  and declared-undelivered bytes at a constant live-document baseline.
- Broker diagnostics expose age/credit/byte/lifecycle state without payloads,
  credentials, query values, private Node APIs, or high-cardinality metric labels.
- The controlled runtime no longer shows reload-correlated step growth in Server
  external/ArrayBuffer.
- Plan 075's lifecycle claims and status are reconciled with this result.

## STOP Conditions

- Electron navigation events cannot distinguish main-frame cross-document
  navigation from same-document routing in the pinned Electron version. Stop and
  design a Main-verified document epoch before implementing a broad cancel.
- A supported first-party finite caller intentionally leaves a body unread beyond
  60 seconds. Stop and add an explicit lease class to the request contract; do
  not silently break Fetch semantics or merely raise the timeout.
- The Fabric characterization test fails. Stop at the first broken edge and
  revise scope before modifying session credit, relay framing, or proxy code.
- Repeated reloads still retain broker requests after navigation tests pass.
  Inspect IPC sender-frame/document identity and HMR module ownership before
  tuning timers.
- Pending Server writes persist after broker cancellation and socket close.
  Capture the adapter/socket ownership chain; do not mask it with smaller message
  payloads or a shorter idle lease.
- Runtime acceptance requires a full heap snapshot while the machine remains
  swap-saturated. Defer that snapshot; use bounded diagnostics until memory
  pressure is safe.

## Follow-ups (separate plans)

- Bound history hydration and avoid repeatedly serializing 30-40 MiB
  `/messages?limit=100` snapshots. This reduces incident severity and latency but
  must not be substituted for lifecycle correctness.
- Diagnose Renderer live-heap retainers and the five-second User Timing cleanup /
  long-task cadence after Server pressure is stable.
- Account for GPU IOSurface/graphics-owned memory separately; it is not Server
  ArrayBuffer.

## Progress

- [x] (2026-08-29) Collected live Server/Main/Renderer/socket evidence and
  reconciled it with the current source at `cf1fdb87`.
- [x] (2026-08-29) Identified broker document ownership as the first proven
  broken cancellation boundary; verified existing Fabric close hooks statically.
- [x] (2026-08-30) Step 1: direct upstream socket and Fabric stream-close
  characterization passed; the existing Fabric production chain required no
  change.
- [x] (2026-08-30) Step 2: document-aware Main ownership, navigation/crash
  cancellation, and preload-owned stale-document fencing.
- [x] (2026-08-30) Step 3: 60-second no-credit lease and bounded payload-free
  diagnostics.
- [x] (2026-08-30) Step 4: Renderer Fetch/SSE/plugin cleanup through idempotent
  document and bootstrap disposal.
- [x] (2026-08-30) Step 5: actual Electron, sandboxed-preload, real-IPC smoke
  returned all four requests to zero after each of ten same-window reloads.
- [ ] Step 6: isolated Electron runtime acceptance is complete. Restart and
  post-restart external/ArrayBuffer observation of the user's live Cradle
  process remain pending to avoid interrupting active work.

## Surprises & Discoveries

- Plan 075's receiver-credit design is doing its intended backpressure job: it
  stops Main from reading when Renderer stops. The missing complementary rule is
  that zero progress must eventually end ownership.
- Plan 077 fixed unbounded queues inside Server stream producers. The current
  dominant objects are outgoing `WriteWrap`/ArrayBuffer bytes below that layer,
  so reopening Plan 077 would address the wrong queue.
- The incident description originally grouped Fabric downstream cancellation
  with the broken chain. Static inspection shows the close handlers already
  exist; the broker currently prevents them from ever being exercised.
- Raw chat text and DOM counts are much smaller than Renderer live heap, but this
  does not prove derived chat state is absent. A retainer path is still required.
- Fabric characterization passed at both relevant boundaries: aborting the
  inbound proxy request closed its real upstream socket, and controller stream
  close reached the node exactly once. No Fabric production edit was warranted.
- Main-observed navigation needs a document identity fence. Without it, a queued
  IPC `open` from the old realm can arrive after Main has advanced ownership and
  be mistaken for a request from the new document.
- The actual sandboxed preload does not provide Node `crypto`, and the smoke's
  `data:` renderer did not provide `crypto.randomUUID`. A 128-bit nonce generated
  with Web Crypto `getRandomValues` works in the supported preload boundary.

## Decision Log

- **2026-08-29 - Fix the first proven owner, not the largest payload.** Broker
  document lifecycle is the P0. Message history size is a separate amplifier.
- **2026-08-29 - Main navigation is authoritative.** Renderer page/HMR cleanup is
  defense in depth because renderer code cannot reliably clean up after its own
  realm is gone.
- **2026-08-29 - Test Fabric before changing it.** Existing stream close and
  socket-destroy hooks are preserved unless an end-to-end cancellation probe
  identifies a specific failure.
- **2026-08-29 - Do not ship private Node request inspection.** Production
  diagnostics use broker-owned measurements and accurately named byte fields.
- **2026-08-29 - Treat 60 seconds as a contract gate, not adaptive tuning.** It
  may ship only after the finite-consumer inventory passes; otherwise execution
  stops for an explicit per-request lease design.
- **2026-08-30 - Fence queued opens with a preload-owned nonce.** Main navigation
  remains the cancellation authority, while the nonce prevents a retired realm
  from acquiring the next document's generation. Renderer application code
  cannot supply or replace it.
- **2026-08-30 - Preserve the existing Fabric protocol.** Focused socket and
  Session tests proved downstream close propagation, so production changes stop
  at the first broken owner: the Desktop broker and Renderer lifecycle.

## Outcomes & Retrospective

The P0 implementation and isolated runtime proof are complete. The Electron
fixture opens one held 2 MiB finite response plus workspace, plugin-development,
and download SSE requests in each document, then reloads the same
`BrowserWindow` ten times.

| Signal | Incident baseline | Post-fix isolated Electron result |
| --- | ---: | ---: |
| Requests retained for an obsolete document | 69 broker requests for one live `WebContents` | 0 after every navigation (`[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]`) |
| Requests active before each reload | Not separated by document | 4 in every document (`[4, 4, 4, 4, 4, 4, 4, 4, 4, 4]`) |
| Fixture response closes | Old sockets remained active | 40 of 40 |
| Navigation cancellations | Not diagnosed | 40 |
| Final broker active/finite/stream requests | 69 / 3 / 66 | 0 / 0 / 0 |
| Final declared-undelivered and broker-buffered bytes | No broker diagnostic; Server had 165.97 MiB pending writes | 0 B / 0 B |

Focused verification passed: 16 Desktop tests, 15 Web tests, and 8 Server/Fabric
tests; Desktop, Web, and Server type checks; scoped ESLint; the production
Electron bundle; the lifecycle smoke; and `git diff --check`.

The fixture demonstrates that reload growth changes from retained old-document
requests to a constant four-request live-document baseline. It does not replace
Step 6's observation of Server external/ArrayBuffer in the user's real workload.
The currently running pre-fix Main process also must be restarted before it can
load this code and release its already-retained objects.
