# Plan 063 Desktop Main transport exploration (Exploration B)

Date: 2026-08-13

Repository HEAD inspected: `9f5f731`

Plan implementation baseline: `d40f895e`

## Scope and evidence

This handoff covers the Desktop Main portion of Plan 063: connection discrimination,
Server process lifecycle and transport generation, an undici-backed transport, privileged
scheme registration order, injection into Main consumers, and restart/shutdown behavior.
It is a read-only production-code investigation; the only repository change made by this
exploration is this handoff.

Sources read:

- `AGENTS.md`
- `plans/063-eliminate-desktop-server-sockets.md` in full, especially M2-M4 and the
  security, acceptance, invariant, and STOP sections
- `apps/desktop/src/main/index.ts`, `main-app.ts`, `server-process.ts`,
  `managed-process.ts`, and `managed-process-runner.ts`
- every production Desktop Main `fetch` call and the associated consumer implementations
- `apps/desktop/src/shared/server-runtime.ts`, `apps/desktop/src/preload/index.ts`, and
  `apps/desktop/src/shared/browser-session.ts`
- current relevant Desktop tests, Desktop packaging/build configuration, and the already
  landed Web connection/readiness scaffold
- Server listener, auth, and health wiring in `apps/server/src/index.ts`,
  `apps/server/src/app.ts`, and `apps/server/src/http/auth.ts`

`apps/desktop/AGENTS.md` does not exist at this HEAD. Root `AGENTS.md` is therefore the only
applicable repository instruction file. The drift check found no committed changes under
the inspected Desktop paths between `d40f895e` and HEAD.

## Executive conclusion

The locked architecture fits the present codebase without changing the Server HTTP
surface: install `cradle-server://` in Electron's default session, keep one stable
credential-owning `DesktopServerTransport` object in Main, and point a fresh undici Agent
at the current ordinary Server listener for each owned generation.

The current code does not yet have any of those ownership seams. `startServer()` returns
only a string; a healthy locator and a newly spawned child become indistinguishable;
renderer bearer credentials are still passed in window arguments; every Main Server
consumer chooses the URL and auth headers independently; and the crash handler restarts a
child without invalidating requests or publishing a new ready connection. A safe
implementation therefore cannot be limited to replacing `fetch` imports. M2 must first
make lifecycle state and transport generation authoritative, M3 must install the scheme in
the correct Electron order, and M4 must inject the same transport into every classified
consumer.

M0 remains a mandatory gate. No production routing should be enabled until the packaged
Electron proof passes.

## Current topology and lifecycle inventory

### Startup sequence

1. `apps/desktop/src/main/index.ts` loads dev/packaged environment configuration and then
   dynamically imports `main-app.ts`. It does not register a privileged scheme.
2. `startDesktopApp()` registers IPC/process handlers and calls `app.whenReady()`.
3. Inside the ready callback, Desktop initializes data/download/update state and creates
   and loads the main BrowserWindow **before** Server startup begins.
4. The renderer asks the preload `serverRuntime` bridge for status and waits for `ready`.
5. `main-app.ts` publishes `starting`, runs migration/backup/plugin work, then calls
   `startServer(publishServerBootstrapSnapshot)`.
6. `server-process.ts` creates/loads the persistent bearer token, then probes the CLI
   locator's `/health`. Because `/health` is explicitly exempt from Server auth, a healthy
   probe proves reachability only; it does not prove that Main's bearer authenticates to
   the located process.
7. A healthy locator returns its URL immediately. Otherwise Desktop chooses a port, forks
   the managed runner/Server, receives bootstrap events over child IPC, and waits for both
   the `listener-establishment:ready` event and a successful HTTP `/health` probe.
8. After a spawned listener is ready, Desktop writes the CLI locator and returns the URL.
   `main-app.ts` constructs all Server-dependent services with that URL and publishes
   `{state: 'ready', serverUrl, bootstrap}`.

The main BrowserWindow currently receives `--server-auth-token` but no initial
`--server-url`; preload falls back to `http://127.0.0.1:21423`. Tearoff and DevTools
windows receive both `--server-url` and `--server-auth-token`. The ready status eventually
overrides the Web runtime URL, but Desktop status still has no connection discriminant.

### Current connection representation

| Concern | Current representation | Consequence |
| --- | --- | --- |
| Spawned vs located Server | Both are a `Promise<string>` result from `startServer()` | Consumers cannot apply owned lifecycle invariants safely. |
| Renderer transport | Implied by the HTTP(S) URL | There is no way to publish `cradle-server://local`. |
| Main proxy target | Same ambient `serverUrl` held independently by consumers | No single place owns pooling, credentials, or invalidation. |
| Generation | None | Requests opened before a restart cannot be fenced from the replacement child. |
| Bearer | Module-global token plus exported `getDesktopServerAuthToken()` / `getDesktopServerAuthHeaders()` | Window creation and every consumer can obtain the long-lived credential. |
| Readiness | Bootstrap snapshot plus `/health` | Correct for a spawned listener, but locator health does not establish auth capability. |

`DesktopServerStatus` in `apps/desktop/src/shared/server-runtime.ts` currently has
`starting`, `migrating`, `bootstrapping`, `ready`, and `failed`; the ready variant contains
only `serverUrl` and `bootstrap`. The Web scaffold already accepts an optional connection
projection, but it is duplicated in `apps/web/src/env.d.ts`,
`apps/web/src/lib/server-readiness.ts`, and
`apps/web/src/lib/server-transport/base-url.ts`, and is looser than the plan-required
discriminant.

### Crash/restart sequence today

The `spawnServer()` exit listener classifies expected versus unexpected exits. On an
unexpected exit it removes the locator and, up to three times, calls `spawnServer(opts)`,
waits for the same `currentServerUrl`, and rewrites the locator.

Important current behavior:

- `serverProcess` is overwritten with the replacement child, but no generation changes.
- The existing bootstrap callback is reused, so Main can regress from `ready` to
  `bootstrapping` as new child events arrive. The restart promise never publishes a new
  `ready` status, so status may remain `bootstrapping` after a successful restart.
- Consumer objects are neither recreated nor notified. This happens to work only because
  the replacement child reuses the same URL and bearer.
- In-flight global/consumer fetches fail according to network timing; there is no central
  active-request map, exact-once invalidation, or stale-generation check.
- The same undifferentiated restart callback owns both process recovery and user-visible
  lifecycle projection.
- `bootstrapSnapshot` is reused rather than freshly initialized for the restarted child.

There is also a shutdown race: if an unexpected exit has already scheduled an async
`spawnServer(opts)` and shutdown calls `stopServer()` before the replacement is assigned
to `serverProcess`, `stopServer()` can finish against the exited child while the scheduled
spawn later creates a new child. A shutdown/restart epoch or explicit `shuttingDown` fence
is required.

### Shutdown sequence today

`shutdownDesktopRuntime()` disposes browser/update/download/notification/chat/plugin/tray/
badge/Mac/plugin services and finally calls `stopServer()`. Main has a five-second outer
force-exit timer. `stopServer()` itself can wait roughly six seconds due to its timeout
race, so a slow child shutdown can already exceed the outer budget.

For an owned managed child, `stopServer()` clears module references and the locator,
marks the exit expected, and stops the managed runner. The runner sends SIGTERM to the
target process group and SIGKILLs it after its grace period. For a locator-reused process,
`stopLocatedServer()` validates its PID/command and then sends SIGTERM/SIGKILL. Thus the
current Desktop stops a process it merely located; that conflicts with the semantic claim
that `attached-http` does not own lifecycle and needs an explicit product decision.

`detachServer()` is unused. Its comment promises detachment while preserving a live
Server/locator, but its implementation simply calls `stopServer()`; it must not be treated
as a valid lifecycle primitive.

The two chat brokers and plugin dev-session sync have their own abort controllers.
Notification and tray timers can be stopped. Observability exports
`stopDesktopResourceReporting()`, but `shutdownDesktopRuntime()` does not currently call
it. Central transport invalidation is still needed because several one-shot/polling
requests have no caller-owned signal.

## Main Server-call inventory

There are eight literal `fetch(` call sites across six production files under Desktop
Main. Seven calls are Cradle Server traffic and one is an intentional exclusion. Three
more consumers call an injected/defaulted fetch function, bringing the current Cradle
Server call sites to 13.

| Owner/file | Current calls | Lifecycle/cancellation today | Required dependency change |
| --- | --- | --- | --- |
| `main-app.ts` | GET `/preferences/desktop` | One startup request; no signal | Inject transport into the preference sync helper; remove direct auth headers. |
| `chat-stream-broker.ts` | POST response and GET stream paths through one `fetchFn` call | Per-entry AbortController, open timeout, broker stop; renderer frame semantics are mature | Replace `serverUrl`/ambient fallback ownership with an injected transport fetch while preserving broker protocol and Plan 061/071 semantics. |
| `chat-event-tail-broker.ts` | Session `/events` and global `/events` through one `fetchFn` call | Per-tail AbortController and broker stop | Inject transport; preserve cursor/replay-tail semantics. |
| `plugin-source-sync.ts` | JSON helper plus long-lived `/plugins/dev-sessions/events` | One long-lived controller; retry loop every second | Replace module-global URL/global fetch binding with transport binding; do not add transport-level replay. |
| `observability-reporter.ts` | POST `/observability/events` and `/observability/runtime-samples` | Pending event queue; periodic timer; requests have no signal | Bind transport instead of URL, stop timer during shutdown, and let transport invalidation cancel in-flight sends. |
| `tray-manager.ts` | Three concurrent GET projections through one helper | 30-second timer; no per-request signal | Add transport to `TrayManagerOptions`; keep URL/path construction separate if needed. |
| `notification-center-manager.ts` | Completed runs, user-input requests, runtime status, queue mutation | Poll timer; no request signal; existing optional `fetchFn` test seam | Replace `fetchFn ?? fetch` and consumer auth with a required injected transport capability. Never replay the queue mutation. |
| `server-process.ts` | `/health` for initial readiness, locator reuse, and located-process validation | Poll loop; no request-level timeout/abort beyond loop deadline | Move Server-bound I/O behind the transport owner. Candidate readiness is pre-activation and needs a private probe seam rather than falsely publishing a ready generation. |
| `browser-manager.ts` | `http://localhost:<port>/` browser-target discovery | Bounded probe of arbitrary local user/browser content | Explicit non-Server allowlist entry; must not use Desktop Server credentials or transport. |

No other direct Desktop Main HTTP constructor targeting the Cradle Server was found.
Download Center and updater networking are different ownership domains and should not be
routed through this transport.

## Plan-locked target contracts

### Connection discriminant

`connection.ts` should own the plan-prescribed union (names and meanings are locked):

```ts
export type DesktopServerConnection =
  | {
      kind: 'owned-proxy'
      rendererTransport: 'main-proxy'
      serverUrl: string
      rendererBaseUrl: 'cradle-server://local'
      generation: number
      mainProxyTarget: string
    }
  | {
      kind: 'attached-http'
      rendererTransport: 'main-proxy'
      serverUrl: string
      rendererBaseUrl: 'cradle-server://local'
      mainProxyTarget: string
      authentication: 'main-bearer'
    }
  | {
      kind: 'attached-http'
      rendererTransport: 'direct-http'
      serverUrl: string
      rendererBaseUrl: string
      authentication: 'browser-session' | 'none'
    }
```

An owned value is created only after the child listener and bootstrap readiness checks
pass. A locator is always `attached-http`, even when Main can proxy it. There is no
`owned-ipc`, no private Request/Response process framing, and no generation claim on an
attached connection.

The ready `DesktopServerStatus` must carry the complete connection projection while
retaining the top-level `serverUrl` and bootstrap snapshot expected by current Web code.
The canonical shared type should make the projection required for the new Desktop build;
only the Web compatibility reader may keep it optional while older Desktop builds remain
supported.

### Transport boundary

The plan's narrow semantic surface is:

```ts
interface DesktopServerTransport {
  fetch(request: Request): Promise<Response>
}
```

Consumers receive this capability and must not select credentials or use ambient global
fetch. Lifecycle-only activation/invalidation/disposal methods may be necessary on the
concrete owner, but should not be exposed through the consumer capability.

The transport module must own:

- the current ready connection and, for owned children, current generation;
- a **fresh undici Agent per owned generation**, even when URL/port is unchanged;
- an active-operation registry that captures generation at dispatch;
- abort propagation from the renderer/caller to undici;
- synchronous invalidation of old operations on child exit/restart/shutdown;
- target URL rewriting while preserving method, path, query, headers, and streaming body;
- response streaming and status/statusText/header parity; and
- credential application at the Main trust boundary, never at a feature consumer.

`undici` must be a direct `@cradle/desktop` dependency (the Server already uses 7.25.0,
but Desktop currently has no direct dependency). `apps/desktop/package.json` and
`pnpm-lock.yaml` are therefore required changes. The current Electron Vite main build
bundles non-runtime dependencies (`noExternal: true`, `externalizeDeps: false`), while
electron-builder excludes general `node_modules`; verify that undici is actually bundled
into `dist/main` and the packaged artifact rather than assuming a transitive install.

Do not pass a Chromium `Request` object directly into undici without proving runtime/type
compatibility. A safe adapter may need to project URL/method/headers/body/signal into
`undici.fetch(..., {dispatcher: agent, duplex: 'half'})` and bridge the undici Response
back to the Response class Electron accepts. M0/M1 must prove that this bridge preserves
streaming, cancellation, multipart bytes, binary bodies, and repeated `set-cookie` values.

### Credential boundary

The renderer-facing protocol handler must reject malformed authorities and strip at least
`authorization`, `cookie`, `proxy-authorization`, and every Cradle credential header
before Main injects its bearer. Consumer modules must stop importing
`getDesktopServerAuthHeaders()`. `getDesktopServerAuthToken()` must no longer be usable by
window creation or feature consumers. The bearer still has to be supplied to a newly
spawned Server as `CRADLE_AUTH_TOKEN`, so credential creation/storage needs a private seam
shared by process lifecycle and transport activation without placing the token in
`DesktopServerConnection`, status, arguments, errors, logs, or diagnostics.

An attached main-proxy connection may be published only after Main proves that the bearer
works against a protected endpoint. Current `/health` is unauthenticated and is not such
proof. A protected, side-effect-free verification endpoint or an explicitly reviewed
alternative must be selected before implementation.

## Privileged scheme ordering

Required order:

1. Add a tiny registration module, preferably under
   `apps/desktop/src/main/desktop-server-transport/`, and call it synchronously from
   `apps/desktop/src/main/index.ts` before the dynamic `main-app` import can reach
   `app.ready`.
2. Register exactly `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, and `stream`.
   Add `codeCache` only if M0 proves real plugin modules require it. Never add `bypassCSP`,
   service-worker, or extension privileges in this plan.
3. After `app.whenReady()` resolves, install exactly one handler on
   `session.defaultSession` **before** `createMainWindow()` loads the renderer. Current
   code creates the main window near the beginning of the ready callback, so handler
   installation must move ahead of that line.
4. The handler exists while transport state is unavailable and returns a deterministic
   unavailable Response until a ready connection is activated. It never falls through to
   loopback HTTP.
5. Accept only protocol `cradle-server:`, hostname `local`, empty port, and empty
   username/password. Compare these fields directly; custom-scheme `URL.origin` is opaque
   and cannot be the authority check.
6. Do not install the handler on `session.fromPartition(...)`. BrowserPanel
   `WebContentsView`s use `persist:cradle-browser-<owner>` partitions from
   `browserSessionPartition()`, so default-session-only installation preserves the
   intended denial boundary.
7. On shutdown, invalidate transport operations and call
   `session.defaultSession.protocol.unhandle('cradle-server')` before final process exit.
   Electron 42.4.1 exposes `Protocol.unhandle` in its installed declarations.

Main/Tearoff/DevTools windows have no explicit partition and therefore use the default
session. That shared session is precisely why one handler covers all owned renderer
traffic without granting BrowserPanel access.

## Required restart and shutdown semantics

### Owned start/restart

A safe event order is:

1. Allocate a monotonically increasing owned child attempt/generation token before
   spawning. Do not reset it when `startServer()` is retried after migration/backup
   rollback.
2. Keep the renderer handler unavailable while spawning and probing the candidate.
3. Require both bootstrap `listener-establishment:ready` and successful health before
   activating/publishing `owned-proxy`.
4. On unexpected exit, synchronously mark the lifecycle unavailable, invalidate the old
   generation, abort/destroy its Agent, and publish `starting`/fresh `bootstrapping` state
   before starting the replacement.
5. Use a new bootstrap snapshot and new Agent for the replacement. After readiness,
   publish a new ready status containing the incremented generation.
6. Never automatically retry a request. An old GET may be resumed only by an existing
   caller recovery policy; an old mutation is failed and never replayed by transport.
7. Keep the injected transport object stable so timers and brokers do not retain a stale
   fetch implementation. Activation changes the owner's internal generation, not each
   consumer's dependency.

Exit callbacks must prove that they still refer to the current child. A stale child exit
must not invalidate a newer generation. Restart scheduling also needs an epoch/abort check
so shutdown cannot race a delayed spawn.

For requests whose `fetch()` promise already resolved but whose response body is still
streaming, invalidation cannot retroactively reject that promise. It must error/cancel the
body stream exactly once. Tests and diagnostics should distinguish `awaiting-headers` from
`streaming-body` operations rather than claiming both fail in the same JavaScript shape.

### Shutdown

Recommended order within the existing hard time budget:

1. Mark lifecycle `shuttingDown` and disable future restart attempts.
2. Stop producer timers/subscriptions (`stopDesktopResourceReporting`, plugin dev sync,
   tray/notification timers, and broker entry creation).
3. Invalidate the current transport generation and abort all active operations. Destroy,
   rather than gracefully drain, the Agent if a graceful close could exceed the force-exit
   deadline.
4. Unhandle the protocol (or leave an unavailable handler until all renderer windows are
   gone, then unhandle); never permit fallback.
5. Stop an owned managed child and clear its locator.
6. Complete remaining service/plugin teardown and exit.

The current five-second outer force-exit timer is shorter than `stopServer()`'s possible
wait. The implementation must either shorten bounded transport/child teardown or revise
the coordinated budget; otherwise shutdown acceptance will be timing-dependent.

Whether Desktop should signal/kill a locator-reused `attached-http` process is unresolved
and must be decided before changing `stopLocatedServer()`. The discriminant's documented
meaning argues against claiming stop ownership, while current product behavior kills a
validated located process.

## Exact affected files and interfaces

### Required production changes for the Desktop Main slice

| File | Interface/change |
| --- | --- |
| `apps/desktop/src/main/desktop-server-transport/connection.ts` (new) | Own the exact `DesktopServerConnection` union and generation semantics. |
| `apps/desktop/src/main/desktop-server-transport/proxy-fetch.ts` (new; name may be `undici-proxy.ts`) | Own undici Agent(s), URL/body/response bridging, active operations, abort, invalidation, disposal, and diagnostics. |
| `apps/desktop/src/main/desktop-server-transport/protocol-handler.ts` (new) | Validate `cradle-server://local`, strip renderer credentials, inject Main auth through the owner, register/unregister default-session handler, and return deterministic unavailable responses. |
| `apps/desktop/src/main/desktop-server-transport/scheme-registration.ts` (new) | Synchronous pre-ready privileged scheme registration. |
| `apps/desktop/src/main/desktop-server-transport/index.ts` (new) | Export only the narrow consumer and lifecycle surfaces. |
| `apps/desktop/src/main/index.ts` | Call scheme registration before dynamically importing `main-app.ts`. |
| `apps/desktop/src/main/main-app.ts` | Create/own transport, install the ready-session handler before any window, consume `DesktopServerConnection`, publish restart-aware status, inject transport into every service, stop reporter/transport/handler during shutdown, and remove bearer arguments. |
| `apps/desktop/src/main/server-process.ts` | Return `DesktopServerConnection`; classify located vs spawned; verify attached auth; expose lifecycle changes to Main/transport; allocate/fence generations; reset bootstrap state on restart; prevent restart during shutdown; stop exporting feature-level auth helpers. |
| `apps/desktop/src/shared/server-runtime.ts` | Make ready status include the complete connection projection and preserve bootstrap snapshot. Extend tests for owned/attached unrepresentable states. |
| `apps/desktop/src/main/chat-stream-broker.ts` | Require injected transport fetch; remove auth-header selection; preserve renderer frames, dedup/fanout, timeout, and recovery ownership. |
| `apps/desktop/src/main/chat-event-tail-broker.ts` | Require injected transport fetch; remove auth-header selection; preserve cursor/tail behavior. |
| `apps/desktop/src/main/plugin-source-sync.ts` | Replace module-global URL/global fetch ownership with injected/bound transport, including the SSE dev-session loop. |
| `apps/desktop/src/main/observability-reporter.ts` | Bind transport, remove auth selection, include transport diagnostics through the existing provider without secrets, and reliably stop the timer. |
| `apps/desktop/src/main/tray-manager.ts` | Add required transport dependency and remove ambient fetch/auth imports. |
| `apps/desktop/src/main/notification-center-manager.ts` | Replace optional ambient `fetchFn` with required fakeable transport dependency; keep queue POST non-replayable. |
| `apps/desktop/src/main/window-manager.ts` | Remove bearer arguments from Tearoff/DevTools windows; consume only non-secret connection projection needed for native WS/runtime status. |
| `apps/desktop/src/preload/index.ts` | Stop parsing/exposing `serverAuthToken`; status bridge remains the connection bootstrap source. |
| `apps/desktop/package.json`, `pnpm-lock.yaml` | Add direct undici dependency and lock resolution. |

`apps/desktop/electron.vite.config.ts` and `electron-builder.mjs` are conditional changes:
touch them only if the M0 fixture or packaged bundling requires an explicit entry/resource.
Do not externalize undici without also packaging it; current builder intentionally excludes
general `node_modules`.

### Tests/docs that must change or be added

- New focused tests under
  `apps/desktop/src/main/desktop-server-transport/` for connection legality, proxy parity,
  authority/auth stripping, generation invalidation, abort races, unavailable state,
  default-session installation, and partition denial.
- `server-process.test.ts`: spawned versus locator classification, protected attached-auth
  verification, fresh restart snapshot/generation, stale exit, shutdown/restart race, and
  located shutdown policy.
- `server-runtime.test.ts`: ready projection exhaustiveness and bootstrap preservation.
- Existing chat broker tests: pass a fake transport while keeping behavioral assertions
  unchanged.
- Existing tray/notification tests: inject fake transport. Tray currently relies on
  ambient fetch mocking and needs a first-class seam.
- New focused tests for plugin source sync and observability reporter, which currently have
  no matching test files.
- `main-app` orchestration needs either extracted pure lifecycle wiring or a targeted
  Electron integration test; there is currently no `main-app.test.ts`.
- `apps/desktop/src/main/README.md` should document the transport owner and the explicit
  BrowserPanel exclusion.

### Downstream contract edges outside this Main slice

- `apps/web/src/env.d.ts` must remove `serverAuthToken` and align the duplicated projection.
- `apps/web/src/lib/server-readiness.ts` already consumes optional ready connection data,
  but unsubscribes after initial ready. Decide whether it must retain a lifecycle listener
  to observe generation/restart states.
- `apps/web/src/lib/server-transport/base-url.ts` already keeps separate renderer and
  network bases, but its projection omits `rendererTransport` and `authentication`, and
  treats generation/target as optional. Align it with the canonical ready projection.
- `apps/web/src/lib/server-credential.ts` already strips standard credentials in custom
  scheme mode, but Main must repeat stripping because the renderer is untrusted.

These are dependency edges, not permission to absorb Web/M5-M6 or Chat lifecycle semantics
into the Desktop transport change.

## Dependency graph

```text
index.ts (pre-ready scheme privilege)
  -> main-app.ts (default-session handler + lifecycle orchestration)
      -> server-process.ts (spawn/locate/readiness/exit facts)
      -> DesktopServerTransport (connection + bearer + undici Agent + generation)
          -> protocol-handler.ts (renderer custom-scheme adapter)
          -> Main consumer capability (feature requests)
      -> DesktopServerStatus IPC
          -> preload bridge
          -> Web readiness/base-url split

managed-process.ts -> managed-process-runner.ts -> Server child
Server child -> ordinary Elysia HTTP listener (unchanged)
```

Credential flow is one-way: private Desktop token storage -> Server child environment and
transport owner -> injected upstream header. It must never flow to connection/status,
preload env, window arguments, diagnostics, or renderer-visible errors.

## Validation plan

### Focused transport and lifecycle behavior

1. Run the M0 development **and packaged** Electron fixture before enabling production
   routing. Prove first-byte streaming, cancellation, streamed upload, 64 MiB bounded
   memory, FormData, image/PDF/binary, real plugin module/CSP behavior, and default-session
   isolation. A bundle build alone is not evidence.
2. Test request parity for GET/POST/PATCH/DELETE/HEAD, query, redirect, JSON/errors,
   body-less 204/304, binary/range, multipart, SSE, repeated headers, slow consumer, abort
   before headers, abort mid-upload/body, and abort after completion.
3. Test exact authority rejection: wrong scheme/host, port, username/password, malformed
   URL. Assert all renderer-controlled credential headers are removed and exactly the
   current Main bearer reaches Elysia auth.
4. Test connection legality at the type/factory boundary: spawned -> owned only after
   readiness; locator -> attached always; auth-required attached cannot become direct
   HTTP without verified browser session and cannot become main-proxy without verified
   Main bearer.
5. Test generation races with controlled upstreams: restart during GET before headers,
   during a streaming body, during a mutation, simultaneous caller abort and exit, stale
   old-child exit after new ready, repeated failed restart attempts, and shutdown while a
   restart spawn is scheduled. Assert no mutation replay.
6. Assert a new Agent is used after owned restart even though `serverUrl` is unchanged;
   old active-operation count returns to zero and old pooled connections are destroyed.
7. Assert the default session can resolve the scheme and each BrowserPanel partition
   cannot. Assert handler unavailable before ready and after invalidation; never observe an
   HTTP fallback.
8. Inject a fake transport into every classified Main consumer and stub global fetch to
   throw. Exercise each consumer and assert global fetch is never reached. Keep an exact
   named allowlist for `browser-manager.ts` local browser-target discovery.
9. Re-run existing chat broker suites unchanged in semantics: fanout/dedup, bounded replay
   tail, cancellation, detached streams, cursor behavior, and diagnostics. A generation
   failure is a transport error; recovery remains feature-owned.
10. Verify shutdown cancels all active transport operations, stops all timers, unhandles
    the protocol, prevents a replacement child, applies the decided attached-process
    policy, and completes inside the coordinated force-exit budget.

### Static and build gates

```bash
pnpm exec vitest run apps/desktop/src/main/desktop-server-transport --maxWorkers=1
pnpm exec vitest run apps/desktop/src/main/server-process.test.ts \
  apps/desktop/src/shared/server-runtime.test.ts \
  apps/desktop/src/main/chat-stream-broker.test.ts \
  apps/desktop/src/main/chat-event-tail-broker.test.ts \
  apps/desktop/src/main/tray-manager.test.ts \
  apps/desktop/src/main/notification-center-manager.test.ts --maxWorkers=1
pnpm --filter @cradle/desktop typecheck
pnpm --filter @cradle/web typecheck
pnpm build:desktop
pnpm --filter @cradle/desktop pack
git diff --check
```

Also require these ratchet checks:

- no `--server-auth-token` or `serverAuthToken` in Desktop Main/preload/Web production
  code;
- no Main Cradle Server consumer imports `getDesktopServerAuthHeaders`, defaults to global
  `fetch`, or constructs an unclassified Server-bound network request;
- no `owned-ipc`, Request/Response process framing, Server IPC HTTP host, or PTY-over-IPC;
- only the reviewed native WebSocket ticket paths use the network `serverUrl` from the
  renderer; and
- packaged many-Tearoff smoke observes zero renderer HTTP(S) connections to the owned
  Server and zero leaked active proxy operations after cleanup/restart.

Record the pre-existing Server/root Chat Runtime failures before implementation and do not
reclassify any new failure as baseline.

## Architecture risks and STOP conditions

### Highest-risk implementation areas

- **Packaged protocol behavior:** streamed bodies, cancellation, 64 MiB memory bounds,
  multipart, subresources, module loading, and session isolation are acceptance facts, not
  assumptions.
- **Candidate readiness versus active transport:** the regular active-generation fetch
  cannot probe a candidate that is not ready without weakening the connection invariant.
  Keep a private undici candidate-probe seam inside the transport/lifecycle boundary.
- **Repeated headers and Response class bridging:** flattening `set-cookie`, buffering a
  body, or returning a Response implementation Electron cannot stream violates HTTP
  parity. Test the packaged path.
- **Redirect credential leakage:** ordinary fetch redirect behavior must not forward the
  injected bearer to another origin/scheme. Validate/contain redirects while preserving
  required Server semantics.
- **Generation invalidation after headers:** a resolved Response promise and its live body
  require different exact-once failure handling.
- **Same-port restart pooling:** reusing an old undici Agent risks stale sockets reaching a
  replacement child. Agent lifetime must be generation-scoped.
- **Restart/shutdown race:** an already scheduled async spawn can outlive `stopServer()`
  unless restart scheduling is fenced.
- **Attached-server ownership/auth:** current health discovery proves neither bearer
  validity nor permission to terminate the process.
- **Shutdown budget:** graceful Agent/child drain can exceed the existing five-second Main
  force-exit timer.
- **Consumer singleton drift:** module-global URL setters in plugin/observability code can
  retain stale state. Bind a stable transport capability once and update only its internal
  active generation.

STOP and report rather than improvise if any Plan 063 STOP condition occurs, especially:

- packaged Electron cannot reliably stream/cancel with bounded memory or cannot load the
  required module/image/PDF/FormData shapes without `bypassCSP` or partition broadening;
- implementation appears to require child-process Request/Response framing, pull-credit
  codecs, a Server IPC HTTP host, or PTY-over-IPC;
- a locator-backed Server is being treated as owned or is auth-required without a proven
  Main bearer/verified browser session;
- native PTY or `/sync` ticket semantics would have to weaken expiry, audience, or
  single-use behavior after bearer removal;
- BrowserPanel partitions would need the custom handler;
- the change would modify Plan 061 admission/completion/queue ownership, Plan 054 cursor
  semantics, Plan 071 snapshot-first recovery, or database schema;
- an owned failure path would silently fall back to renderer HTTP(S); or
- a verification gate fails twice after reasonable correction or relevant baseline facts
  materially drift.

If M0 fails, the only plan-sanctioned next step is a separate local HTTP/2 TLS Plan B—not
private process IPC.

## Explicit uncertainties requiring decisions

1. **Attached auth proof:** Which protected, side-effect-free endpoint establishes that
   Main's persisted bearer belongs to the located process? `/health` cannot do this.
2. **Attached shutdown:** Should app quit leave `attached-http` running, or preserve the
   current validated-PID termination behavior? The connection definition and current code
   point in different directions.
3. **Generation numbering:** The plan requires increment on restart but does not specify
   whether failed spawn attempts consume numbers. Recommendation: allocate one monotonic
   token per owned child attempt and publish only successful ready generations.
4. **Post-ready renderer status:** Web readiness unsubscribes after initial ready. Must Web
   observe later starting/ready generations, or is the stable custom scheme/network URL
   plus feature-owned recovery sufficient?
5. **Unavailable response contract:** Status code/body/headers are described only as
   deterministic. Choose and test a non-sensitive contract (for example 503 with a stable
   code) before consumers depend on it.
6. **Redirect policy:** Exact allowed redirect behavior, especially same-Server versus
   cross-origin redirects, needs a reviewed rule that prevents bearer leakage.
7. **Response bridge:** Confirm whether Electron 42 accepts undici's Response directly in
   `protocol.handle`; otherwise define the streaming conversion and multi-value header
   strategy from M0/M1 evidence.
8. **Credential module ownership:** Decide how process spawn and transport activation share
   the bearer privately without keeping the current broadly exported token/header helpers
   or creating a circular dependency.
9. **Consumer call shape:** The plan writes `fetch(request: Request)`, while current tests
   and consumers use the two-argument `typeof fetch` shape. Prefer the locked Request-only
   capability unless M1 evidence justifies a narrow alternative; do not leave optional
   ambient fallbacks.
10. **Attached liveness after ready:** There is no current monitor/restart policy for an
    attached process. Decide whether status should regress on observed proxy failure or
    simply surface request errors; do not claim owned recovery.
11. **Protocol teardown timing:** Decide whether to `unhandle` before or after renderer
    windows close. Either choice must first make transport unavailable and must not expose
    fallback behavior.
12. **`codeCache`:** Enable only if the real packaged plugin module proof requires it.

## Handoff quality checklist

- [x] Current behavior is separated from plan-locked target behavior.
- [x] Startup, readiness, crash/restart, and shutdown paths are inventoried end to end.
- [x] All Desktop Main Cradle Server call sites and the one literal-fetch exclusion are
  classified.
- [x] Exact required files, interfaces, dependency edges, and downstream status consumers
  are named.
- [x] Connection/auth/generation invariants and non-replay semantics are explicit.
- [x] Privileged registration and default-session handler ordering is explicit.
- [x] Validation covers unit, integration, packaged Electron, static ratchet, typecheck,
  build, stress, security, cancellation, and cleanup.
- [x] Architecture risks and all relevant STOP conditions are called out.
- [x] Ambiguities are listed as decisions rather than silently resolved.
- [x] No production source or user-owned unrelated file was modified by this exploration.
