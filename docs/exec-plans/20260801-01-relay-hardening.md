# Harden relay request recovery, concurrency, and remote surfaces

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. The repository has no root `PLANS.md`; this plan follows the ExecPlan rules supplied by `/Users/wibus/.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

After this work, a paired remote Cradle Server remains usable when its relay WebSocket drops during an idempotent HTTP request, a burst of 128 concurrent 64 KiB requests cannot wedge the shared tunnel, and WebSocket-based remote features such as terminal sockets can traverse the same authenticated upstream gateway. Managed local relayd startup becomes single-flight, unsupported Node runtimes fail with an actionable compatibility message instead of crashing on the zstd import, and the remote-host settings surface gains a fixture-driven View boundary. A contributor can observe the result through focused failure tests, the real-relayd end-to-end matrix, Node capability checks, server/web typechecks, and the relay runtime benchmark.

## Progress

- [x] (2026-08-01 02:30Z) Inspected relay controller/host transports, flow control, relayd scheduler, upstream gateway, managed relayd supervisor, Node zstd usage, and the remote-host settings surface.
- [x] (2026-08-01 02:30Z) Revalidated Plan 011 against current code and recorded why its original drift gate cannot be used unchanged.
- [x] (2026-08-01 16:07Z) Added bounded GET replay/mutation-no-replay tests and expanded the real-relayd matrix to 64/128 concurrency plus 32 hung streams and a post-load probe.
- [x] (2026-08-01 16:07Z) Implemented one bounded bodyless read replay after resolving the current tunnel; abort and unsafe methods never retry.
- [x] (2026-08-01 16:07Z) Proved the current relay credit/scheduler implementation already survives the reported pressure; retained the new 128-stream regression instead of changing passing window constants.
- [x] (2026-08-01 16:07Z) Added authenticated WebSocket upstream bridging with binary/text/close propagation, remote-ticket isolation, and bounded congestion handling.
- [x] (2026-08-01 16:07Z) Made managed local relayd startup single-flight and covered concurrent warm start with one recorded child launch.
- [x] (2026-08-01 16:07Z) Enforced and diagnosed the Node zstd runtime requirement without named-export module-load failure.
- [x] (2026-08-01 16:07Z) Extracted a typed fixture-driven `RemoteHostsSettingsView`, fixtures, and Storybook states from production query/mutation ownership.
- [x] (2026-08-01 16:37Z) Ran the focused hardening suite (29 tests), server typecheck/boundaries, relayd Go tests, real-relayd performance matrix, changed-file ESLint, and diff hygiene. The repository-wide server suite reached 1,570 passing tests but retains 25 failures in unrelated stale/environment-sensitive suites; web typecheck is likewise blocked by unrelated existing files, while the new settings files pass ESLint.

## Surprises & Discoveries

- Observation: Plan 011 was written against `ac47f3b`, but every listed relay area has materially drifted; its own drift command therefore triggers its STOP condition.
  Evidence: `git diff --stat ac47f3b..HEAD -- apps/server/src/modules/relay-servers apps/server/src/modules/conversation-bridge apps/server/src/modules/relay-transport` reports 23 changed files and more than 2,400 insertions.
- Observation: the current host connector already reserves its map entry before starting its synchronous background loop, so the remaining demonstrated Plan 011 race is managed local relayd startup.
  Evidence: `HostConnectorService.startForEnrollment` calls `connections.set` before `connection.start()`, whereas `startManagedLocalRelayd` awaits launch/address resolution before assigning `runningLocalRelayd`.
- Observation: relay session connection credit is measured in plaintext bytes while relayd queue capacity is measured in envelopes and wire bytes. The default queue permits only 64 envelopes, so 128 simultaneous stream opens exercise a different bound than the 16 MiB session byte window.
  Evidence: `RELAY_CONNECTION_MAX_CREDIT_BYTES` is 16 MiB; relayd defaults are 64 envelopes and 4 MiB.
- Observation: `compression.ts` statically imports Node zstd exports. A runtime lacking those exports fails before code can emit an actionable version error or disable compression.
  Evidence: the import declaration names `zstdCompressSync` and `zstdDecompressSync` directly from `node:zlib`.
- Observation: the reported 128-stream tunnel hang does not reproduce on current `main`, including when 32 earlier requests remain open forever.
  Evidence: the real-relayd matrix completed 128 64 KiB requests with p50 400.68 ms, p95 748.54 ms, max 778.28 ms in the loaded focused run, and the post-load GET returned HTTP 200.
- Observation: mounting a `.ws` route inside an adapter-neutral Elysia plugin makes Node-adapter HTTP tests fail before handlers run.
  Evidence: the first full-suite run failed ordinary HTTP suites with `Current adapter doesn't support WebSocket`; registering the Upgrade route directly on the Node-adapted root app restored those suites, and a real WebSocket gateway test now passes.
- Observation: this checkout's native `better-sqlite3` binary targets Node 24 (ABI 137), while the interactive Homebrew default was Node 25 (ABI 141).
  Evidence: tests under Node 25 failed at database open; the desktop-owned Node 24.18.1 runtime matches the native binary and passes the focused suites. Both runtimes satisfy the new Node 22.15 minimum.

## Decision Log

- Decision: replace Plan 011's stale execution gate with this plan and change only races that still exist in current code.
  Rationale: applying stale line-level instructions would conflict with the repository's architecture-first rule; current source already fixed the host-connector reservation ordering.
  Date/Author: 2026-08-01 / Codex
- Decision: automatic request replay will be owned by the remote-host upstream service and restricted to methods whose HTTP semantics are idempotent and whose bodies can be replayed exactly.
  Rationale: the tunnel transport cannot know whether a partially delivered mutation is safe to repeat. The upstream owner knows the method and body, can wait for a new connection generation, and can enforce a bounded attempt count.
  Date/Author: 2026-08-01 / Codex
- Decision: WebSocket upstream is a separate bridge, not an attempt to make Fetch handle Upgrade.
  Rationale: Fetch does not expose a portable HTTP Upgrade path; a bridge must explicitly own both sockets, authentication audiences, frame kinds, backpressure, and close propagation.
  Date/Author: 2026-08-01 / Codex
- Decision: keep UI interaction state in the View, but move all queries, mutations, generated clients, and query-cache invalidation to Containers.
  Rationale: this is the rendering seam required by repository instructions and produces a Storybook/fixture-compatible surface without reproducing application runtime decorators.
  Date/Author: 2026-08-01 / Codex
- Decision: do not retune relay session credit or relayd queue constants after the expanded current-source reproduction passes.
  Rationale: the repository forbids heuristic fixes without discussion, and the current scheduler already isolates 32 hung streams from a 128-request burst. A regression matrix is the evidence-backed hardening change.
  Date/Author: 2026-08-01 / Codex

## Outcomes & Retrospective

Implementation and focused verification are complete. A header-level GET, HEAD, or OPTIONS transport failure now returns its failed base URL to the remote-host lifecycle owner; that owner single-flights replacement of the failed connection generation before the one allowed replay. Mutations, response bodies that already emitted bytes, and WebSocket conversations remain deliberately non-replayable. The current relay scheduler passed 1/8/64/128 × 64 KiB requests while 32 streams stayed hung, so this change records that pressure as a regression rather than heuristically retuning passing credit constants. Remote WebSocket Upgrade is productized and covered through a real local server, and the settings surface has a fixture-driven View/Storybook seam even though deeper dependency-owning subcontainers remain in the legacy production file.

## Context and Orientation

`apps/relayd/internal/relay/hub.go` is the opaque relay server. It validates outer binary envelopes, queues control and data envelopes for the peer, and writes them to a WebSocket. A scheduler is the in-memory queue that reserves room for control frames and round-robins data by logical stream.

`apps/server/src/modules/relay-transport/session.ts` is the encrypted multiplexing state machine shared by controller and host. A logical stream represents one TCP connection. Credit is the number of bytes a sender may keep in flight before the receiver acknowledges local application of those bytes. `controller-transport.ts` exposes a loopback HTTP listener and maps accepted sockets to streams. `host-connector.ts` maps those streams to the remote Cradle Server's local TCP port and injects the relay authentication token into HTTP request headers.

`apps/server/src/modules/remote-hosts/service.ts` owns connection generations, reconnection, and the current loopback base URL. `upstream.ts` owns HTTP request forwarding. This owner boundary is where a failed idempotent request can wait for a new generation and be replayed; neither relayd nor the encrypted session can infer application semantics.

`apps/server/src/modules/remote-hosts/index.ts` exposes `/remote-hosts/:hostId/upstream/*`. The current `.all` route forwards ordinary HTTP via Fetch. WebSocket Upgrade requires an Elysia `.ws` route and a `ws` client connected through the current tunnel base URL.

`apps/server/src/modules/relay-servers/local-relayd-supervisor.ts` starts the bundled or development relayd. The running handle is assigned only after asynchronous setup, leaving concurrent callers able to spawn twice. A single-flight promise means all concurrent callers await the same startup operation and the latch is cleared in `finally`.

`apps/server/src/modules/relay-transport/compression.ts` currently assumes Node's zstd API exists at import time. The repository must state the minimum supported Node version and perform a capability check before compression is used.

`apps/web/src/features/settings/remote-hosts-settings.tsx` mixes a 2,000-line UI with React Query, generated clients, cache invalidation, and local interaction state. The production Container must derive typed props and callbacks; the View may own open/expanded/selection state but no external data source.

## Plan of Work

First, extend the real-relayd harness and focused unit suites with bounded deadlines. Add one case that kills the controller relay WebSocket while an idempotent request is in flight and proves exactly one successful replay after a new connection generation. Add a companion assertion that a non-idempotent streaming mutation is not replayed automatically. Extend the concurrency matrix to 64 and 128 streams, make later probe requests part of acceptance, and ensure all helpers acknowledge bytes only after socket writes complete.

Second, expose a reconnect-aware resolver from `remote-hosts/service.ts`. Update `upstream.ts` to make at most one retry for bodyless GET, HEAD, and OPTIONS requests after the lifecycle owner replaces the failed connection generation. Never retry a mutation or request body. Abort must always win, and existing typed `AppError` contracts remain intact.

Third, validate session and relayd backpressure with the current scheduler and credit implementation. Keep the existing control reservation and credit constants when the 128-stream pressure plus hung-stream isolation and post-load probe pass; preserve the measured matrix as regression coverage rather than changing limits without evidence.

Fourth, add a remote-host WebSocket bridge module. It will validate the local single-use WebSocket ticket against the local upstream path, remove that ticket before constructing the upstream URL, connect with `ws` through the current loopback tunnel, forward text and binary frames without reinterpretation, respect buffered-amount backpressure, and propagate close code/reason in both directions. Connection loss terminates the socket; WebSocket conversations are not replayed.

Fifth, refactor `startManagedLocalRelayd` into a small public single-flight wrapper and private startup operation, clearing the latch on success, skip, and failure. Add a concurrent-start test with a fake executable that records one spawn.

Sixth, replace static zstd named imports with a runtime capability boundary typed from Node's zlib module, add an actionable minimum-version error, and declare the supported Node engine in package metadata and developer documentation. Compression tests must cover an injected unavailable-capability path without requiring an old Node installation.

Seventh, split the settings surface at dependency boundaries. Place the fixture-renderable production View and its typed models in feature-owned files, and keep query/mutation Containers next to it. Reuse owning API response types and existing UI primitives; do not introduce frontend projections where generated owner types already suffice. Preserve static Tailwind classes and `cn()` composition.

Finally, run focused and broad validation. Update this plan after every milestone with measured results, update the older plan index to record the superseding implementation, commit with the Cradle trailer, and deliver through the managed Work pull request flow.

## Concrete Steps

Run commands from the repository root.

    pnpm --filter @cradle/server test -- tests/relay-transport/session.test.ts tests/relay-transport/e2e.test.ts apps/server/src/modules/remote-hosts/upstream.test.ts
    pnpm --dir apps/relayd test
    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/web typecheck
    pnpm --filter @cradle/server benchmark:relay:runtime
    pnpm exec eslint apps/server/src/modules/relay-transport apps/server/src/modules/remote-hosts apps/server/src/modules/relay-servers apps/web/src/features/settings/remote-hosts-settings* --no-cache
    git diff --check

The failure-first e2e run should initially show the 128-stream or disconnect-replay assertion fail within its explicit deadline rather than hang indefinitely. After implementation, all commands should exit zero. The benchmark output should include cold handshake, warm first-byte, 8, 64, and 128 concurrency rows with zero failed requests and a successful post-load probe.

## Validation and Acceptance

Acceptance requires observable behaviors, not only compilation. A header-level transport hangup after a GET begins must pass the failed connection identity to the remote-host owner, establish or reuse a newer generation, and perform exactly one replay. The fake upstream must observe no duplicate non-idempotent request. Cancelling the downstream request must stop waiting or replaying.

A batch of 128 concurrent 64 KiB loopback requests must settle within the test deadline, all responses must match their request bodies, and a later GET on the same logical remote host must succeed. Relayd tests must demonstrate that queue wakeups remain live under concurrent enqueue and drain and that control frames continue to progress.

Opening a WebSocket through `/remote-hosts/:hostId/upstream/terminal-sessions/.../socket` must complete Upgrade, pass text and binary frames in both directions, and close both peers when either side closes. The local authentication ticket must not appear in the request seen by the remote server.

Two simultaneous managed relayd warm starts must create one child and one database upsert. A simulated missing zstd capability must return an actionable message naming Node 22.15 as the minimum instead of throwing an import-link error.

`RemoteHostsSettingsView` must render from fixtures without QueryClient, routing, Electron, generated clients, or settings runtime context. The production `RemoteHostsSettings` Container must preserve existing behavior and pass web typecheck.

## Idempotence and Recovery

Tests use temporary data directories and loopback ports and may be rerun. A failed relay process is terminated through the existing managed-process owner, not with broad process matching. Single-flight latches are cleared in `finally`, so a later explicit retry is possible. Request replay is limited to bodyless read methods and retains no request buffer. WebSocket bridges close both sides and remove their registration on every terminal path. No database schema change is planned.

If the real-relayd test fails midway, rerun the same focused command; its `afterAll` cleanup owns the subprocess and temporary directory. If a UI extraction produces type errors, keep the dependency-owning Container as the production export until the View props are complete; do not create a compatibility wrapper that leaks queries back into the View.

## Artifacts and Notes

Baseline facts captured before edits:

    Node: v25.3.0; zstdCompressSync and zstdDecompressSync are functions.
    Relay session aggregate plaintext credit: 16 MiB.
    Relayd default queue: 64 envelopes / 4 MiB, with one-eighth reserved for control.
    Existing real-relayd e2e matrix: concurrency 1 and 8 only.
    Remote-host settings production file: 2,150 lines with queries and mutations at multiple nested levels.

## Interfaces and Dependencies

Keep `RelaySession` as the sole owner of encrypted stream sequencing and credit. Any new pending-byte limit must be expressed in `RelaySessionOptions` and defaulted from constants in `protocol.ts`. Keep `remote-hosts/service.ts` as the sole owner of connection generations and `upstream.ts` as the sole HTTP replay policy owner.

The reconnect-aware HTTP interface must expose enough information to distinguish connection generations without leaking tunnel implementations. The replay policy must accept a replayable request factory rather than reuse an already-consumed `ReadableStream`.

The WebSocket bridge uses the repository's existing `ws` dependency and Elysia WebSocket route support. It must use `verifyWebSocketRequestToken` for the local audience and must not forward authorization, cookies, local relay credentials, or local tickets. Relay authentication continues to be injected by `RelayHttpRequestWriter` on the host side.

The UI View props must use `GetRemoteHostsResponse`, `GetRelayServersResponse`, and existing remote workspace contracts where available. Callbacks represent semantic actions such as connect, disconnect, test, save, claim, load workspaces, and load files. Containers may use React Query and generated clients; Views may use React local state and translation only if fixtures provide the translation boundary already used by Storybook.

Revision note (2026-08-01): Created after source inspection to supersede the stale Plan 011 execution gate and cover the full C1-C6 hardening request.

Revision note (2026-08-01 16:07Z): Recorded implementation completion, the non-reproduction of the stale C2 failure on current source, measured loaded concurrency results, and the decision to retain regression coverage without heuristic window changes.

Revision note (2026-08-01 16:37Z): Recorded root-adapter WebSocket integration, fresh-generation replay ownership, final focused verification, and unrelated repository-wide validation failures.
