# Plan 063: Eliminate Desktop Tearoff HTTP/1.1 pool starvation via custom-scheme proxy

> **Executor instructions**: Read this entire plan before changing source. Execute the
> milestones in order and run every verification gate. Milestone 0 is a mandatory
> packaged-Electron feasibility proof; do not begin the production migration until it
> passes. If a STOP condition occurs, stop and report instead of inventing a private
> framing protocol, per-route RPC, silent HTTP fallback, or compatibility shim. When
> complete, update this plan's row in `plans/README.md` unless the reviewer explicitly
> owns the index.
>
> **Architecture is LOCKED.** Do not invent multiplexed child-process IPC
> Request/Response framing, pull-credit body protocols, Server `desktop-transport/`
> process hosts, or PTY duplex over process IPC. Main proxies ordinary HTTP with
> undici to the existing Elysia listener; WebSocket stays native.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 00ba970e..HEAD -- \
>   apps/desktop/src/main \
>   apps/desktop/src/preload \
>   apps/desktop/src/shared/server-runtime.ts \
>   apps/desktop/package.json \
>   apps/server/src/index.ts \
>   apps/server/src/bootstrap-lifecycle.ts \
>   apps/server/src/app.ts \
>   apps/server/src/modules/pty \
>   apps/server/src/modules/sync-gateway \
>   apps/server/package.json \
>   apps/web/src/api-gen \
>   apps/web/src/features/chat \
>   apps/web/src/features/download-center/transport.ts \
>   apps/web/src/features/tui/pty-channel.ts \
>   apps/web/src/features/workspace/file-tree.tsx \
>   apps/web/src/lib \
>   apps/web/src/main.tsx \
>   apps/web/src/tearoff-main.tsx \
>   apps/web/src/env.d.ts \
>   packages \
>   package.json \
>   pnpm-lock.yaml
> ```
>
> The original audit was at `598007aa`; facts were revalidated at `00ba970e`. Architecture
> was rewritten on 2026-08-02 away from multiplexed process IPC framing. Plan 061 remains
> in progress and Plan 071 owns snapshot-first Chat recovery. Transport-only drift may be
> reconciled; any change to Chat admission, completion, cursor, queue, provider, or
> snapshot-recovery ownership is a STOP condition for this plan.

## Status

- **Priority**: P0
- **Effort**: M–L; 8 gated milestones spanning Desktop and Web (Server HTTP surface unchanged)
- **Risk**: MEDIUM–HIGH (packaged custom-scheme gate remains the hard risk)
- **Depends on**: Plan 038 (DONE), Plan 040 (DONE), Plan 054 (DONE)
- **Coordinates with**: Plan 061 (IN PROGRESS) and Plan 071 (DONE); this plan changes
  transport only and must preserve snapshot-first recovery
- **Category**: migration / tech-debt
- **Planned at**: commit `598007aa`, 2026-07-23
- **Revalidated at**: commit `00ba970e`, 2026-07-31
- **Architecture rewrite**: 2026-08-02 (custom-scheme + undici proxy; IPC framing deleted)

## Decision and confidence

**Decision: GO, conditionally on the packaged M0 gate.** Development Electron 42.4.1
already proved custom-protocol first-byte streaming and cancellation, multipart
`FormData`, image loading, dynamic module import, binary bodies, renderer streamed
upload, and default-session isolation without `bypassCSP` or `codeCache`. A disposable
session probe also showed `session.defaultSession.fetch` retaining an HttpOnly
browser-session cookie.

That is deliberately not the production acceptance claim: packaged Electron and a 64 MiB
resource bound remain version- and packaging-sensitive. Milestone 0 is the sole hard
feasibility gate before the production migration. If it fails, stop; do not invent a
private framing protocol as a substitute. Plan B if M0 fails is documented below
(local HTTP/2 TLS), not child-process IPC framing.

The architectural decision is:

```text
Desktop-owned local Server

renderer fetch / subresource / SSE-via-fetch
  -> cradle-server://local/... (Electron defaultSession protocol.handle)
  -> Electron main: strip renderer credential headers, inject owned bearer
  -> undici Agent -> loopback HTTP (v1)
                 or Unix domain socket / named pipe (v2, optional)
  -> existing Elysia HTTP listener (unchanged; stays for CLI)

renderer WebSocket (PTY, /sync)
  -> native WS to loopback
  -> authenticated via HttpOnly browser-session cookie
  -> WS does NOT consume Chromium's HTTP/1.1 6-connection pool

Auth
  - renderer NEVER receives the owned Server bearer token
  - Main owns the bearer
  - for owned-proxy AND attached-http, Main establishes an HttpOnly session
    cookie in session.defaultSession before authenticated renderer traffic
  - custom-scheme requests: Main injects bearer after stripping renderer
    Authorization / Cookie / proxy-authorization / Cradle credential headers
```

For a Server discovered through the locator rather than spawned by this Desktop process,
the custom-scheme proxy still may be used only when Main can reach that listener and mint
a session cookie; the connection kind remains explicitly `attached-http` and does not claim
the owned-proxy invariant. Never silently label attached traffic as owned.

### Why not `owned-ipc`

Earlier drafts of this plan used `owned-ipc` and designed a multiplexed child-process
Request/Response framing protocol. That approach is **rejected**:

- It invents a private protocol parallel to HTTP without buying pool relief that the
  custom scheme + undici path does not already provide.
- PTY and `/sync` already have correct native WebSocket semantics; forcing them over
  process IPC duplicates channel state and broadens failure modes.
- The managed runner exists for process-group shutdown and crash containment, not as an
  application-layer request mux.

Prefer the discriminant names:

| Kind | Meaning |
| --- | --- |
| `owned-proxy` | This Desktop spawned the Server child. Renderer HTTP/SSE uses `cradle-server://local`; Main proxies with undici to the owned listener (loopback v1 / UDS v2). |
| `attached-http` | Locator reuse / external live process. Explicit HTTP(S) base; no claim of owned-proxy invariants. |

Do **not** resurrect `owned-ipc`. If code or docs still say `owned-ipc`, treat that as drift
to rename during implementation.

### What "zero socket" means now

The product problem is Chromium's HTTP/1.1 **per-origin six-connection pool** shared by
the main window and all Tearoffs. Long-lived SSE/`fetch` streams starve ordinary API
calls.

The invariant is therefore:

```text
renderer -> owned Server over Chromium HTTP/1.1 pool (http/https fetch/SSE)  = 0
renderer -> owned Server via cradle-server:// (protocol.handle, not that pool) = allowed
renderer -> owned Server native WebSocket (cookie auth; not HTTP/1.1 pool)     = allowed
Electron main -> owned Server                                                  = undici
                                                                               loopback (v1)
                                                                               or UDS (v2)
```

Optionally, v2 replaces loopback TCP with a Unix domain socket / named pipe so Main↔Server
HTTP has zero TCP. That is an optimization, not a prerequisite for fixing Tearoff
starvation. Inventing a private IPC framing protocol is **not** required for either claim.

## Purpose and Big Picture

Electron's default Chromium session applies the HTTP/1.1 per-origin connection pool to
the main window and all Tearoff windows. Long-lived SSE requests consume those slots, so
opening enough independent Chat, workspace, workflow, Download Center, or plugin streams
can starve ordinary API calls even though every process is local. Sharing only identical
SSE subscriptions cannot solve the general case because different sessions and features
have different upstream streams.

The fix must remove renderer HTTP/SSE from that pool, not raise a limit Chromium does not
expose as a reliable product contract. In Desktop-owned mode:

1. All renderer Fetch / subresource / SSE traffic uses `cradle-server://local`, handled in
   Main and proxied with undici to the existing Server listener.
2. WebSocket (PTY, `/sync`) stays native to loopback and authenticates with an HttpOnly
   session cookie established by Main.
3. The Server keeps listening on HTTP for CLI and attached clients; Desktop does not replace
   `app.handle` over a private framing layer.

Logical request count may grow with Tearoffs; Chromium's six-slot HTTP/1.1 pool must not.

## Context and Orientation

The target retains the Server's HTTP listener for the CLI and explicit attached clients.
The existing Elysia HTTP application remains the one request contract. Desktop Main is a
credential-owning reverse proxy for the renderer custom scheme, not a second API surface.

The following facts are the revalidated starting point for implementation.

### Window and connection topology

- `apps/desktop/src/main/window-manager.ts` creates Tearoffs without a
  `webPreferences.partition`. They share the default Electron session and therefore the
  same Chromium per-origin connection pool for `http:`/`https:` traffic.
- `main-app.ts` and `window-manager.ts` still pass the long-lived local Server token into
  renderer command-line arguments; preload and `apps/web/src/env.d.ts` still expose it.
- `DesktopServerStatus` has a bootstrap snapshot (`starting`, `migrating`,
  `bootstrapping`, `ready`, `failed`), but its ready state still has only `serverUrl` and
  cannot distinguish an owned child from a locator-backed process or publish a renderer
  transport base.
- `main-app.ts` creates the main window before starting the Server. Scheme registration must
  therefore happen synchronously in `index.ts`, and default-session handler installation
  must occur before the renderer can receive a ready endpoint.

### Requests are concentrated enough to adapt once

- `apps/web/src/lib/client.config.ts` injects `cradleFetch` into the generated client.
- `apps/web/src/lib/server-credential.ts` resolves the configured base URL, adds the
  renderer-visible bearer token, and calls global `fetch`.
- The generated client exposes hundreds of operations. Creating one IPC method per route
  would duplicate the HTTP contract; this plan never does that.
- Binary, `FormData`, module, image, PDF, and download consumers exist in addition to JSON
  APIs. Raw traffic also includes asset uploads and plugin descriptor fetches.
- Production files instantiate native `EventSource` (Chat, workflow, Download Center,
  workspace, plugin host). All owned-mode sites must move to fetch-backed SSE through
  `cradle-server://local`.
- Production files instantiate native `WebSocket` for PTY and `/sync`. Those remain native
  WebSocket to loopback after cookie bootstrap; they are not migrated to process IPC.

Inventory commands to rerun before implementation:

```bash
rg -l 'new EventSource' apps/web/src --glob '!**/*.test.*' | sort
rg -l 'new WebSocket' apps/web/src --glob '!**/*.test.*' | sort
rg -l 'fetch\(' apps/desktop/src/main --glob '!**/*.test.*' | sort
rg -l 'getServerUrl\(\)|getConfiguredServerUrl\(\)|SERVER_BASE' \
  apps/web/src --glob '!**/*.test.*' --glob '!**/api-gen/**' | sort
rg -l 'FormData\(|\.blob\(\)|\.arrayBuffer\(\)' \
  apps/web/src apps/desktop/src/main --glob '!**/*.test.*' | sort
```

### Existing chat IPC is only half of the route

- Chat stream and event-tail transports already prefer Desktop bridges before sync
  WebSocket / native `EventSource`.
- Desktop chat brokers still open upstream Server response streams with `fetch` over HTTP.
  Different session Tearoffs therefore still consume distinct Chromium-visible or
  main-process Server connections depending on path.
- The brokers remain useful ownership boundaries. Inject
  `DesktopServerTransport.fetch` (undici loopback/UDS proxy) into them. Do not rewrite
  their renderer-facing frame semantics.
- Plan 061 owns Chat run admission/completion. Plan 071 owns snapshot-first recovery.
  This plan must not restore exact replay or absorb either plan's semantics.

### The existing HTTP listener is the reusable contract

- `createServerApp()` builds one Elysia app; `index.ts` calls `app.listen()`.
- Existing Server tests call `app.handle(new Request(...))`, proving in-process Fetch
  execution, but **this plan does not add a Server process-IPC host**. Desktop Main talks
  to the ordinary HTTP listener (loopback or later UDS) with undici.
- CLI and attached clients keep using that listener unchanged.

### Startup currently performs an HTTP health probe

- `server-process.ts` may reuse a healthy locator-backed process (`attached-http`).
- A newly spawned Server is waited on through `waitForServer()`, which currently polls
  `/health` with `fetch`. That remains acceptable for Main→Server undici traffic; it must
  not become a renderer Chromium-pool consumer, and owned readiness must not require the
  renderer to probe `/health`.
- `bootstrap-lifecycle.ts` publishes startup phases over child IPC. Compose with that
  reporter; do not invent a competing phase enum. Child IPC remains for bootstrap/control
  messages only — not for HTTP Request/Response framing.

### Electron 42 exposes the required primitive

`apps/desktop/package.json` pins Electron `42.4.1`. Its installed type declarations expose:

```ts
protocol.registerSchemesAsPrivileged([{
  scheme: 'cradle-server',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}])

session.defaultSession.protocol.handle(
  'cradle-server',
  (request: Request) => Promise<Response>,
)
```

`registerSchemesAsPrivileged` must run before `app.ready`; the session handler must be
installed after readiness but before any app window can issue Server requests. Protocol
handlers are session-scoped, so install it on `session.defaultSession` only. BrowserPanel
web contents use explicit partitions and must not gain access to this handler.

### Revalidation probes and remaining uncertainty

- A disposable development Electron probe passed custom-scheme streaming, cancellation,
  `FormData`, `<img>`, dynamic `import()`, binary bytes, streamed upload, and partition
  denial.
- A disposable Electron session probe received an HttpOnly `cradle-session` cookie from a
  local response and sent it on the next `session.defaultSession.fetch`. Main-owned cookie
  bootstrap therefore has a supported development path.
- Earlier two-hop advanced-serialization IPC probes are **historical only**. They justified
  the rejected framing design; they are not acceptance evidence for this rewrite and must
  not be reintroduced as production work.

The remaining unknowns are deliberately narrow: the packaged artifact must reproduce the
custom-scheme behaviors, including a 64 MiB resource bound and real plugin module/CSP
behavior. They are M0 acceptance evidence, not an unproven architecture assumption.

## Alternatives considered and rejected

| Alternative | Why it is not the final architecture |
| --- | --- |
| Raise Chromium's six-connection limit | No supported Electron product contract makes this unlimited; flags are brittle. |
| Give every Tearoff a separate session partition | Multiplies cookies/cache/auth state and only moves the cap per partition. |
| Share only Chat EventSource instances | Cannot combine different sessions/features/streams. |
| One IPC method per HTTP route | Duplicates hundreds of operations and creates permanent contract drift. |
| Multiplexed child-process Request/Response framing (`owned-ipc`) | Invents a private protocol, PTY/sync duplex, pull-credit codec, and Server process host without solving anything the custom-scheme + undici proxy does not already solve. **Rejected in the 2026-08-02 rewrite.** |
| PTY duplex over process IPC | `protocol.handle` cannot do WebSocket upgrade; native WS does not consume the HTTP/1.1 pool and already owns PTY semantics. |
| Base64 / whole-body IPC buffering | Unnecessary once Main uses ordinary HTTP streaming via undici. |
| Use native `EventSource` on the custom scheme | Header, reconnect, and custom-scheme behavior is not a safe cross-platform contract. A fetch-backed SSE adapter is explicit and testable. |
| Convert `cradle-server:` into `ws:` for PTY | No corresponding network origin exists; WebSocket upgrade is not implemented by `protocol.handle`. |
| Bypass Elysia / call domain services from Main | Splits auth/validation/error semantics into a second public API. |
| Remove the managed runner | Broadens process-lifecycle risk; runner is unrelated to the browser pool. |
| Silent owned → loopback HTTP fallback in the renderer | Reintroduces the exact pool starvation this plan exists to eliminate. |

### Plan B if M0 fails

If packaged Electron cannot make `cradle-server://` streaming/cancellation/module/binary
behavior reliable with supported APIs, **STOP** the custom-scheme migration and report.
Do not invent process IPC framing as a substitute.

A separately designed Plan B may then evaluate **local HTTP/2 over TLS** (single
multiplexed connection from the Chromium network stack to loopback) as an alternative
pool fix. That Plan B is out of this document's implementation milestones; mentioning it
here prevents executors from "saving" a failed M0 by restoring sockets or inventing IPC.

## Target ownership and module boundaries

### Desktop transport owner

Create a deep module under `apps/desktop/src/main/desktop-server-transport/` (name may
vary slightly; keep the boundary clear):

- `connection.ts` owns the `owned-proxy` / `attached-http` discriminant and generation.
- `proxy-fetch.ts` (or `undici-proxy.ts`) implements
  `fetch(request: Request): Promise<Response>` with an undici `Agent` targeting loopback
  HTTP (v1) or UDS/named pipe (v2).
- `protocol-handler.ts` owns `cradle-server://local` validation, credential stripping,
  bearer injection, and default-session registration.
- `session-cookie.ts` owns Main-side browser-session cookie establishment for owned and
  attached modes.
- `index.ts` exports the narrow surface consumed by `main-app.ts`, brokers, and services.

Consumers receive a `DesktopServerTransport` dependency. They must not choose credentials
themselves and must not open ambient global `fetch` to the owned Server.

**No** `packages/desktop-server-contracts` multiplex framing package.
**No** Server `desktop-transport/` process host calling `app.handle` over IPC.

### Web transport owner

Keep `cradleFetch` as the generated client's fetch hook. In Desktop `owned-proxy` mode its
runtime base URL becomes `cradle-server://local`; in browser/attached mode it retains
HTTP(S). Create a fetch-backed SSE adapter under `apps/web/src/lib/server-transport/` and
route all owned-mode native EventSource sites through it. Keep feature parsers and cursor
ownership in their current feature modules.

PTY and `/sync` keep native WebSocket clients. After Main establishes the HttpOnly session
cookie, those sockets authenticate like ordinary browser clients. Do not build a
transport-neutral PTY process-IPC adapter in this plan.

### Server surface

Unchanged for this plan's critical path:

- Keep `app.listen()` / HTTP listener for CLI and Desktop undici proxy.
- Keep existing auth plugins, including browser-session cookie minting.
- Optional later: accept HTTP over UDS/named pipe without changing route semantics.
- Do not add IPC Request/Response framing hosts.

## Required connection model

Replace `startServer(): Promise<string>` with a discriminated result:

```ts
export type DesktopServerConnection =
  | {
      kind: 'owned-proxy'
      serverUrl: string // loopback listener / CLI locator / diagnostics
      rendererBaseUrl: 'cradle-server://local'
      generation: number
      /**
       * v1: http://127.0.0.1:<port>
       * v2 (optional): undici socketPath / Windows named pipe target
       */
      mainProxyTarget: string
    }
  | {
      kind: 'attached-http'
      serverUrl: string // loopback/network URL for WS + diagnostics
      /**
       * Prefer `cradle-server://local` when Main can reach the listener and mint a
       * session cookie (same Tearoff pool problem). Fall back to explicit HTTP(S)
       * only when Main cannot proxy. Never claim owned-proxy crash/generation invariants.
       */
      rendererBaseUrl: 'cradle-server://local' | string
      mainProxyTarget?: string
    }
```

- `owned-proxy` means this Desktop instance created the child, the listener is ready, and
  Main can proxy after cookie/bearer ownership is established.
- `attached-http` means `readHealthyLocatedServerUrl()` found another live process. When
  Main can reach that listener, renderer Fetch/SSE still uses `cradle-server://local` so
  Tearoffs do not re-enter the Chromium HTTP/1.1 pool; the kind remains `attached-http`
  for ownership/credential semantics and must not claim owned generation/crash invariants.
  If Main cannot proxy, `rendererBaseUrl` stays explicit HTTP(S).
- WebSocket clients always use `serverUrl` (loopback/network HTTP(S) URL), never
  `cradle-server://`. No separate `wsBaseUrl` field in v1; expose
  `getServerNetworkUrl()` from status.`serverUrl` for PTY/`/sync`.
- Server restarts increment `generation` for `owned-proxy`. Pending Main proxy operations
  from the old generation fail closed.
- Do not automatically fall back from a broken `owned-proxy` custom-scheme path to
  renderer loopback HTTP. Silent fallback reintroduces pool starvation.
- `serverUrl` may still be written to the CLI locator. The owned-proxy invariant concerns
  renderer Chromium-pool avoidance, not CLI clients or Server-owned remote calls.
- v2 UDS/named pipe is **after M7 only**; do not schedule it inside M0–M7.

`DesktopServerStatus` must retain its existing bootstrap snapshot and expose the complete
connection projection in its ready state, including `connection.kind`,
`rendererBaseUrl`, and `serverUrl` (network base for native WebSocket). Web readiness must
use the ready status directly in Electron; it must not probe `/health` from the renderer.

## Proxy and protocol semantics

### Custom-scheme HTTP proxy (owned-proxy)

1. Accept only `cradle-server://local/...`. Reject credentials, ports, other hosts, and
   malformed URLs. Do not use `URL.origin` as the authority check: standard custom URLs
   have an opaque origin. Compare protocol, hostname, and port directly.
2. Convert the custom URL to the canonical internal HTTP URL (or UDS-targeted request)
   before undici fetch so Elysia route and URL semantics remain unchanged.
3. Strip renderer-supplied `authorization`, `cookie`, `proxy-authorization`, and Cradle
   credential headers. Main injects the current owned Server bearer into the proxied
   Request.
4. Stream request and response bodies; do not whole-buffer uploads/downloads. Honor
   `AbortSignal` end-to-end.
5. Preserve status, statusText, headers (including repeated `set-cookie` via multi-value
   APIs), and body-less HEAD/204/304 responses.
6. Return a deterministic unavailable response before owned connection readiness; never
   fall through to renderer-visible loopback HTTP.
7. Redirect behavior must match fetch and must not escape to an arbitrary scheme without
   the existing web security policy.

### undici Agent (v1 / v2)

- **v1 (required for Done)**: undici `Agent` to `http://127.0.0.1:<port>` (or the owned
  listener address already published by Server startup).
- **v2 (optional follow-up)**: same Fetch semantics over Unix domain socket / Windows
  named pipe. No renderer changes if Main keeps `cradle-server://local` stable.
- Connection pooling and keep-alive live in undici/Main, not in the Chromium renderer pool.
- Chat brokers, tray, preferences, observability, plugin sync, and other Main consumers
  call `DesktopServerTransport.fetch` rather than ambient global `fetch`.

### WebSocket (PTY, `/sync`)

- Remain native `WebSocket` to the loopback listener.
- Authenticate with the HttpOnly browser-session cookie Main established in
  `session.defaultSession`.
- Do not carry PTY frames over process IPC.
- Do not claim WebSocket uses the HTTP/1.1 six-connection pool; the Tearoff starvation
  bug is about long-lived HTTP/SSE slots.
- If an owned-mode feature incorrectly opens EventSource tickets or bearer-query WS URLs
  that re-expose credentials, that is a defect against the auth invariants below.

### Cancellation and failure

- Renderer abort cancels the protocol handler's undici request.
- On child exit/restart, reject every old-generation pending Main proxy request exactly
  once and increment generation.
- Never automatically replay a mutation. Reads may be retried only by existing
  caller-level policy after a new ready generation.

## Security invariants

1. The renderer never receives the Desktop-owned Server's long-lived bearer token.
2. For both `owned-proxy` and `attached-http`, Main establishes the existing
   browser-session cookie in `session.defaultSession` (via session fetch or explicit
   cookie API) before the renderer starts authenticated traffic that depends on cookies
   (notably WebSocket).
3. The custom protocol handler accepts only the exact `local` authority and the app
   default session. BrowserPanel partitions are not registered.
4. Every proxied HTTP request still runs through the Server's normal HTTP stack: auth,
   validation, CORS, request-id, error mapping, and route middleware.
5. Main injects credentials after stripping renderer-controlled credential headers.
6. Request ids, URLs, status, sizes, duration, and cancellation reason may be observed;
   authorization headers, cookies, request bodies, response bodies, and PTY contents may
   not be logged.
7. Remote-host proxy behavior inside the Server remains Server-owned and continues to obey
   Plan 038 credential-audience rules.

Endpoint settings remain HTTP(S)-only for user-entered values. A separate internal
runtime-base setter may accept the custom scheme, and endpoint identity checks must
compare protocol/host/port rather than opaque custom origins.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0, including boundary checker |
| Server boundary | `pnpm --filter @cradle/server check:boundaries` | exit 0 |
| Desktop typecheck | `pnpm --filter @cradle/desktop typecheck` | exit 0 |
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Focused Desktop tests | `pnpm exec vitest run apps/desktop/src/main/desktop-server-transport --maxWorkers=1` | all pass |
| Focused Web tests | `pnpm --filter @cradle/web exec vitest run src/lib/server-transport src/features/chat/transport --maxWorkers=1` | all pass |
| Server suite | `pnpm --filter @cradle/server test` | all pass or only recorded pre-existing failures |
| Web suite | `pnpm --filter @cradle/web test` | all pass |
| Root suite | `pnpm test` | all pass or only recorded pre-existing failures |
| Lint | `pnpm lint` | exit 0 or only recorded pre-existing failures |
| Desktop bundle | `pnpm build:desktop` | exit 0 |
| Packaged runtime | `pnpm --filter @cradle/desktop pack` | unpacked artifact and its M0 smoke pass |
| Diff hygiene | `git diff --check` | no output |

If a listed focused test file does not exist yet, create it in the milestone that first
names it. Record the exact pre-existing full-suite baseline before editing; never relabel a
new failure as baseline.

## Scope

**In scope**:

- Desktop transport owner under `apps/desktop/src/main/desktop-server-transport/` with
  undici-backed `DesktopServerTransport.fetch`.
- `cradle-server` privileged scheme registration before app readiness and a handler on
  `session.defaultSession` only.
- `DesktopServerConnection` (`owned-proxy` / `attached-http`), `DesktopServerStatus`,
  startup, crash/restart, and shutdown projection changes in Desktop main/shared/preload/
  Web environment contracts.
- Injection of the shared transport into Desktop chat brokers, plugin source sync, tray,
  notification, preferences, observability, readiness, and every other main-process call
  whose destination is the Cradle Server.
- Web base-URL/fetch adapter changes, fetch-backed SSE migration, binary/FormData/module/
  image/PDF parity, and removal of the Desktop-owned token from renderer arguments.
- Main-owned HttpOnly browser-session cookie bootstrap for owned and attached modes so
  native WebSocket (PTY, `/sync`) authenticates without renderer bearer exposure.
- A static transport-boundary ratchet and a targeted Electron packaged Tearoff stress smoke.
- Documentation in affected Desktop, Web, Chat, and PTY module READMEs.
- Optional design note / non-blocking spike path for v2 UDS/named-pipe undici targets.

**Explicitly out of scope**:

- `packages/desktop-server-contracts` multiplexed pull-credit framing.
- Managed-runner bidirectional binary Request/Response protocol host.
- Server `desktop-transport/` process host calling `app.handle` over IPC.
- PTY duplex channel over process IPC (PTY stays native WebSocket).
- Changing Chat admission, completion, queueing, durable facts, provider lifecycle, or
  snapshot-first recovery/cursor semantics owned by Plans 061, 071, and 054.
- Replacing Elysia routes with feature RPC methods.
- Changing database schema or adding a transport table.
- Removing the HTTP listener or CLI locator.
- Moving Server-owned remote HTTP/WebSocket calls onto Desktop IPC.
- Installing the custom protocol handler in BrowserPanel partitions.
- Reworking relay, remote-host, plugin ownership, Download Center ownership, or PTY
  business semantics.
- Generic browser UI E2E work. Only a transport-focused Electron smoke is justified.
- Silent renderer HTTP fallback for an owned child.
- Implementing Plan B (local HTTP/2 TLS) inside this plan unless M0 fails and a new plan
  is opened.

## Git workflow and delivery slices

- Use the managed Work branch and preserve unrelated changes in the worktree. Re-run the
  drift command before each slice instead of relying on the original planned-at diff.
- Use conventional commit messages consistent with the repository.
- Deliver in independently reviewable slices after Milestone 0:
  1. connection model + undici proxy fetch + protocol handler;
  2. Desktop main consumer migration + chat broker injection;
  3. Web `cradleFetch` / SSE / subresource migration;
  4. credential removal + session cookie bootstrap;
  5. ratchet + packaged Tearoff stress + docs.
- Commit each coherent slice after its focused verification and use the managed Work PR
  delivery flow for the resulting commit.

## Plan of Work

Establish packaged custom-scheme facts before production seams. Then make Desktop lifecycle
own the `owned-proxy` / `attached-http` choice, implement undici proxy fetch behind
`cradle-server://local`, migrate Main and Web HTTP/SSE consumers, establish HttpOnly
cookies so native WebSocket stays correct without renderer bearer tokens, and ratchet the
Chromium-pool invariant so it cannot regress.

## Milestones

### M0 - Prove Electron 42 behavior in development and packaged mode

Build a minimal test fixture using the proposed privileged scheme and
`session.defaultSession.protocol.handle`. It may live under
`apps/desktop/src/main/desktop-server-transport/fixtures/` and must use a fake upstream
(for example a local undici/http target or in-memory handler), not production Server
business logic. The disposable development probe already proved the mechanics; replace it
with this committed fixture. Prove all of the following in both `electron-vite`
development and the unpacked artifact produced by `pnpm --filter @cradle/desktop pack`:

- fetch GET/POST and non-2xx `Response` status/headers;
- streamed response first-byte delivery without whole-body buffering;
- renderer cancellation invokes response-stream `cancel`;
- streamed request body where supported by renderer fetch;
- at least a 64 MiB binary download with bounded process memory;
- `FormData` upload preserves multipart bytes/content type;
- `<img src="cradle-server://local/...">` loads;
- dynamic `import('cradle-server://local/.../web.mjs')` evaluates a module, including the
  repository's real plugin bundle/CSP shape where the fixture cannot prove it;
- a PDF/binary response remains readable by its real consumer or a representative fixture;
- the handler is available in the default app session and unavailable in a BrowserPanel
  partition.

Capture automated assertions, not screenshots. Measure main/renderer RSS before and during
the 64 MiB transfer; steady-state growth must remain bounded by a documented small number
of chunks rather than body size.

**Verify**: the focused fixture tests pass, `pnpm build:desktop` exits 0, and the unpacked
artifact smoke runs from the `pack` output. Store the exact launch command, artifact path,
RSS result, and platform result in this plan's Progress section when executing. A bundle
build alone is not packaged-runtime evidence.

**Gate**: if any required custom-protocol behavior cannot be made reliable in the packaged
artifact using supported Electron APIs, STOP. Do not start the production migration, do not
replace it with hidden buffering, and do not invent process IPC framing. Open Plan B
(local HTTP/2 TLS) as a separate decision if product still requires a pool fix.

### M1 - Freeze connection ownership and HTTP parity with characterization tests

Before changing production routing, add reusable request/response fixtures against the
existing Server HTTP listener (and `app.handle` where useful for pure app semantics).
Cover JSON, typed errors, redirects, empty bodies, repeated headers (including repeated
`set-cookie`), SSE, binary range/full responses, multipart upload, abort before headers,
abort mid-body, and slow-consumer backpressure. Add current connection-mode tests for new
child versus reused locator.

Characterize the existing snapshot-first Chat recovery boundary as a transport fixture:
proxy migration may carry the same frames but must neither retain active-run history nor
reintroduce exact replay behavior superseded by Plan 071.

Add a test-only socket/pool ownership recorder for the future Electron smoke. It must
identify renderer `http:`/`https:` connections to the owned Server by process and
destination, not merely count browser DevTools entries.

**Verify**: the new parity suite proves current HTTP behavior and fails if a fixture
response is buffered, altered, or loses cancellation.

### M2 - Build undici-backed `DesktopServerTransport.fetch` and connection lifecycle

Implement `DesktopServerTransport.fetch` with undici:

- rewrite/proxy to the owned listener;
- stream bodies;
- honor abort;
- strip/inject credentials only at the Main boundary when used by the protocol handler;
- keep per-request state private to the transport module.

Refactor `startServer()` to return `DesktopServerConnection`. A spawned child becomes
`owned-proxy` only after listener establishment / existing bootstrap completion. A reused
locator is `attached-http`. On restart, invalidate the old generation and publish
starting/ready status again with the connection projection and `rendererBaseUrl`.

Inject this fetch adapter into both chat brokers first. Do not alter their renderer-facing
frame semantics or Plan 061 lifecycle behavior.

**Verify**: fetch adapter tests cover M1 fixtures, restart during GET, restart during
mutation, stale generation, and abort races. Chat broker suites pass unchanged except for
their injected upstream implementation.

### M3 - Register and serve `cradle-server://local` on the default session

Create a tiny scheme-registration module imported synchronously by
`apps/desktop/src/main/index.ts` before `main-app` can reach `app.ready`. Register only the
required privileges: `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, and `stream`;
add `codeCache` only if M0 proves it is required for plugin modules. Never enable
`bypassCSP`, service workers, or extension access without a separate security review.

After Electron readiness and before app windows issue Server requests, install one handler
on `session.defaultSession`. Validate protocol, hostname, and an empty port directly (not
`URL.origin`), strip credential headers, inject the owned bearer, delegate to
`DesktopServerTransport.fetch`, and return a standard Response. Return a deterministic
unavailable response before owned readiness; never fall through to renderer HTTP. Do not
install a handler on `session.fromPartition(...)` BrowserPanel sessions.

Publish `DesktopServerStatus` with the connection discriminant. In owned-proxy mode, Web
runtime base URL is `cradle-server://local`; in attached mode it remains the explicit HTTP
URL. Keep persisted user-entered endpoint validation HTTP(S)-only; the custom scheme is an
internal runtime value, not a setting users can store.

**Verify**: M0 fixture becomes a production-handler integration test; invalid authorities
fail closed; default-session and partition isolation tests pass; Desktop and Web typecheck.

### M4 - Route every Electron-main Server call through the transport

Replace ambient Server-bound `fetch` calls with injected `DesktopServerTransport.fetch` in:

- `main-app.ts` desktop preferences;
- `plugin-source-sync.ts`, including dev-session events;
- `observability-reporter.ts`;
- `tray-manager.ts`;
- `notification-center-manager.ts` and both chat brokers;
- Server readiness/restart diagnostics in `server-process.ts` where those calls are
  Server-bound product traffic (health waits may use the same undici transport).

Audit every match from `rg -l 'fetch\(' apps/desktop/src/main`. Explicitly exclude
`browser-manager.ts` local browser-target probing, which is not Desktop -> Cradle Server
traffic. Document every other exclusion next to the boundary ratchet.

**Verify**: unit tests inject a fake transport and assert no Server consumer reaches global
`fetch` in `owned-proxy` for classified consumers. A static check has an exact allowlist
for non-Server main-process fetches and rejects new unclassified matches.

### M5 - Move Web HTTP/SSE/subresource traffic to `cradle-server://local`

Teach the Web endpoint runtime to distinguish internal `cradle-server://local` from stored
HTTP(S) endpoints. Keep the persisted/user-entered endpoint normalizer HTTP(S)-only and add
a separate internal runtime-base setter for the custom scheme. `cradleFetch` must preserve
Request objects and bodies when rebasing, and must not forward renderer auth/cookie headers
in owned-proxy mode (Main owns injection). The generated client continues to use its
existing fetch hook; do not edit generated files manually.

Create one fetch-backed SSE transport that accepts `Request`, `AbortSignal`, reconnect
policy, event name/id/retry fields, and last-event/cursor construction supplied by the
feature owner. Add `eventsource-parser` as a direct Web dependency at the currently locked
3.x version; do not rely on a transitive copy and do not hand-roll frame parsing.

Migrate every owned-mode native EventSource site. Preserve each feature's existing event
name, snapshot-before-events, reconnect, cursor, parse-error, and disposal behavior. Chat
Desktop bridges may remain because they already provide useful main-owned fanout, but their
upstream fetch must be the M2 transport. Native EventSource remains available only for
browser/attached adapters where required.

Audit URL consumers and the raw-fetch allowlist. Exercise actual paths for generated JSON,
`FormData`, assets/images, binary downloads, workspace PDF preview, plugin `web.mjs`
dynamic import, and plugin descriptor fetch. External URLs and data URLs continue using
ordinary fetch.

**Verify**:

- Web boundary/typecheck tests cover URL selection for owned-proxy, attached, browser,
  external, and data URL cases.
- SSE tests cover CRLF/LF frames, multiline data, comments/heartbeats, id/retry, split
  UTF-8 chunks, abort, reconnect, cursor resume, malformed payload ownership, and no
  reconnect after disposal.
- `rg -n 'new EventSource' apps/web/src --glob '!**/*.test.*'` returns only an explicitly
  documented non-owned adapter, never an owned-proxy call path.

### M6 - Remove renderer bearer credentials; bootstrap HttpOnly session cookies

Remove `--server-auth-token` from main and Tearoff `additionalArguments` entirely, then
remove `serverAuthToken` from preload and Web environment types. Main is the credential
owner:

- custom-scheme path: inject bearer into undici-proxied Requests after stripping renderer
  credential headers;
- WebSocket / cookie-authenticated browser APIs: Main establishes the existing
  browser-session cookie in `session.defaultSession` with its bearer credential before the
  renderer starts authenticated owned or attached traffic.

Verify that Electron session fetch persists the server `Set-Cookie`; if it does not, parse
and set that exact cookie through the Electron cookie API. Do not retain a renderer
bearer-token fallback.

PTY and `/sync` continue to use native WebSocket URLs derived from the loopback listener,
now relying on the HttpOnly cookie. Do not add process-IPC PTY bridges.

**Verify**:

```bash
rg -n -- '--server-auth-token|serverAuthToken' \
  apps/desktop/src/main apps/desktop/src/preload apps/web/src
```

returns no owned-mode credential exposure. Security tests prove renderer-supplied auth is
stripped, main injection succeeds, cookie bootstrap allows PTY/`/sync` WebSocket auth, and
BrowserPanel content cannot call the custom scheme.

### M7 - Add the ratchet and targeted many-Tearoff packaged smoke

Add a transport-boundary checker that classifies Cradle Server network constructors in
Desktop/Web production code. It must fail on a new owned-proxy:

- `http://`/`https://` Server URL passed to renderer fetch / EventSource;
- native `EventSource` against the owned Server;
- Electron-main ambient global fetch to the owned Server outside the undici transport
  allowlist;
- credential argument/exposure;
- any reintroduction of multiplexed process Request/Response framing or per-route IPC
  methods that bypass the HTTP listener.

The checker must allow:

- native WebSocket to loopback for PTY/`/sync` after cookie bootstrap;
- explicit browser/attached HTTP adapters;
- non-Server destinations;

only by named, reviewed rule.

Create one targeted Electron integration smoke, not a generic UI E2E. In a packaged-like
runtime:

1. start a Desktop-owned Server;
2. open the main window plus at least 20 Tearoffs across distinct sessions;
3. keep more than six independent Chat/event streams active via custom-scheme /
   fetch-backed SSE / Desktop brokers;
4. perform concurrent JSON mutations, binary reads, one upload, and one PTY WebSocket
   session;
5. cancel streams, close half the windows, restart the Server, and resume cursor-aware
   reads;
6. record process/socket ownership and transport diagnostics.

The smoke must assert the invariant below rather than merely observe that the UI appears
responsive. Add transport diagnostics with active proxy request counts, generation,
bytes/chunks, and cancellation totals, but no sensitive contents.

**Verify**: all commands in "Commands you will need" pass, the packaged smoke passes on
the release platforms available in CI, and `git diff --check` is empty.

### Optional follow-up (not a Done blocker): v2 UDS / named pipe

After M7, Main may target the owned Server over a Unix domain socket or Windows named pipe
with the same undici Fetch API. Renderer still sees only `cradle-server://local`. This
yields zero Main↔Server TCP without inventing a framing protocol. Track as a small
follow-up if product wants it; do not block the Tearoff pool fix on it.

## Validation and Acceptance

### Proxy fetch parity

- GET/POST/PATCH/DELETE/HEAD and query preservation.
- JSON success plus existing 400/401/403/404/409/500 error mapping.
- Empty, text, JSON, binary, multipart, 64 MiB streaming, range, redirect, and repeated
  header responses.
- Abort before headers, mid-request, mid-response, after end, and simultaneous child exit.
- Many concurrent logical streams through the custom scheme without renderer HTTP/1.1 pool
  starvation.
- Auth middleware executes on proxied requests; uncredentialed internal requests are
  rejected when expected.
- Repeated `set-cookie` values survive attached/owned cookie bootstrap.

### Connection lifecycle

- Spawned child selects `owned-proxy`; locator reuse selects `attached-http`.
- Wrong or incomplete readiness never publishes owned-proxy ready.
- Restart changes generation and rejects old pending mutations without replay.
- Shutdown drains/cancels active proxy maps and removes listeners.
- Existing bootstrap phase UI remains monotonic while transport readiness gates only the
  final owned connection.

### Electron protocol

- Exact scheme/host validation and credential-header stripping.
- Default-session availability and BrowserPanel partition denial.
- Fetch, image, PDF/binary, module import, FormData, streaming, and cancellation in both
  dev and packaged builds.
- Renderer cannot observe the owned Server token through argv, preload, headers, errors,
  logs, or diagnostics.
- Custom-scheme endpoint identity never relies on `URL.origin`.

### Streams, Chat, and WebSocket

- SSE parser conformance, split chunks, cursor reconnect, cancellation, and disposal.
- Existing Chat broker fanout/dedup behavior with the new injected upstream fetch.
- Plan 054 cursor/resume regression suites remain valid, and Plan 071 snapshot-first
  recovery is unchanged (no active-run replay is reintroduced).
- PTY and `/sync` remain native WebSocket with cookie auth; no process-IPC PTY adapter.
- Owned-proxy renderer code does not open `http:`/`https:` EventSource or fetch against
  the owned Server.

### Stress and resource bounds

- At least 20 distinct Tearoffs and more than six simultaneous long-lived streams.
- Zero renderer Chromium HTTP/1.1 pool connections to the owned Server throughout the test.
- Active proxy request counts return to baseline after windows close.
- Memory does not scale with total upload/download body size; record a numeric threshold
  established by M0 and apply it in CI with platform allowance.

## Idempotence and Recovery

All milestones are additive until their focused parity tests pass. Restarting an owned
Server invalidates exactly one generation; it cancels active proxy maps and lets existing
feature-owned recovery decide whether a read can resume. A failed M0 fixture or packaged
smoke leaves production routing untouched. Never delete the HTTP listener, locator, or
attached adapter as part of this migration.

## Required runtime invariant

For Desktop-owned local Server (`owned-proxy`) and every Tearoff count `N >= 0`:

```text
renderer -> owned Server via Chromium HTTP/1.1 http(s) fetch/SSE   = 0
renderer -> owned Server via cradle-server:// protocol.handle      = allowed
renderer -> owned Server native WebSocket (cookie auth)            = allowed
Electron main -> owned Server                                      = undici loopback (v1)
                                                                     or UDS/pipe (v2)
private multiplexed process Request/Response framing               = 0
```

## Done criteria

All boxes must be machine-verified:

- [ ] M0 passes in both development and packaged Electron 42.4.1 with bounded streaming,
  cancellation, binary, FormData, image, PDF, module import, and session isolation.
- [ ] `DesktopServerConnection` cannot represent a locator-backed process as `owned-proxy`.
- [ ] No production code path names or implements `owned-ipc` framing.
- [ ] Generated and hand-written Server fetches preserve status, statusText, headers,
  errors, binary bodies, multipart bodies, streaming, and cancellation versus HTTP.
- [ ] Elysia auth/validation/CORS/request-id/error middleware runs on proxied requests.
- [ ] Large upload/download paths are streamed, never whole-buffered for proxy convenience.
- [ ] Every Desktop main Server consumer uses one injected transport.
- [ ] Every owned-proxy SSE consumer uses a fetch-backed or existing Desktop broker path;
  no native EventSource opens an owned Server `http:`/`https:` connection.
- [ ] PTY and `/sync` use native WebSocket with HttpOnly cookie auth in Desktop.
- [ ] BrowserPanel partitions cannot resolve `cradle-server://local`.
- [ ] Attached/browser HTTP behavior and authentication remain functional and explicitly
  identified as not satisfying the owned-proxy invariant.
- [ ] The renderer no longer receives the Desktop-owned Server bearer token.
- [ ] Restart rejects pending mutations without automatic replay; cursor-aware reads can
  recover through existing feature policy.
- [ ] The boundary ratchet rejects new owned-proxy Chromium-pool HTTP/SSE call sites and
  any reintroduction of process Request/Response framing.
- [ ] The 20-Tearoff packaged smoke proves the Chromium-pool assertion and active proxy
  state returns to baseline after cleanup.
- [ ] Server, Desktop, and Web typechecks pass.
- [ ] Focused tests, Server tests, Web tests, root tests, lint, and Desktop build pass, with
  any pre-existing baseline failures recorded before implementation.
- [ ] `git diff --check` returns no output.
- [ ] A final `git status --short` contains no accidental generated artifacts or unrelated
  source modifications, and `plans/README.md` is updated.

## STOP conditions

Stop and report; do not improvise if any condition occurs:

- Electron 42.4.1 custom protocols cannot stream `Response` bodies with cancellation and
  bounded memory in the packaged app.
- Dynamic plugin module import, image/PDF/binary loading, or required FormData semantics
  cannot work reliably through the privileged scheme without `bypassCSP` or broadening the
  handler to untrusted sessions.
- A correct implementation appears to "require" multiplexed child-process Request/Response
  framing, pull-credit codecs, Server `desktop-transport/` IPC hosts, or PTY-over-IPC.
  That is a design regression against this rewrite — stop and re-read the locked
  architecture rather than implementing it.
- A locator-backed Server is encountered where the implementation assumes owned-proxy
  credentials or custom-scheme exclusivity without the `attached-http` discriminant.
- The work requires a database schema change.
- The executor would need to modify Plan 061 Chat admission/completion/queue ownership,
  Plan 054 cursor semantics, or Plan 071 snapshot-first recovery rather than only transport
  adapters.
- Electron default-session cookie bootstrap cannot preserve WebSocket / attached
  authentication without returning the bearer credential to the renderer.
- BrowserPanel partitions must receive the custom protocol handler to make an app feature
  work; that is a security-boundary change requiring separate review.
- A verification gate fails twice after a reasonable correction, or the planned-at
  current-state facts have materially drifted.

## Maintenance notes

- Treat `cradle-server://local` + undici as a private Desktop proxy, not a second API. New
  Server routes automatically travel through ordinary HTTP with no Desktop contract message
  changes.
- Preserve the owned-proxy / attached-http distinction in logs, diagnostics, settings, and
  bug reports. A successful attached HTTP run is not evidence for the owned-proxy
  invariant.
- Reviewers should scrutinize cancellation, generation fencing, repeated headers, auth
  injection, cookie bootstrap, partition isolation, and cleanup more than happy-path JSON
  calls.
- Plan 028 intentionally used Desktop-main HTTP because no proxy seam existed. This plan
  supersedes that transport limitation while preserving Plan 028's plugin ownership.
- The HTTP listener remains useful for CLI, undici proxy targets, and attached clients.
  Removing it is a separate product decision.
- If someone proposes restoring process IPC framing to "finish zero sockets," point them
  at the invariant section: zero Chromium HTTP/1.1 pool usage is the product goal; UDS is
  the optional TCP optimization; private framing is not.

## Artifacts and Notes

- The development-only Electron protocol probe was intentionally deleted after recording
  its result; M0 must replace it with committed, reproducible source fixtures.
- The current package command is `pnpm --filter @cradle/desktop pack`, which runs the
  Desktop build and `electron-builder --dir`. `pnpm build:desktop` is useful bundle/type
  evidence but is not a packaged-runtime test.
- Re-run the drift command at the top of this document before starting each delivery slice;
  `00ba970e` is the revalidation baseline, while `598007aa` remains the historical plan
  origin.
- Historical note: drafts before 2026-08-02 described `packages/desktop-server-contracts`,
  managed-runner binary Request/Response relay, Server `desktop-transport/` process host,
  and PTY duplex over IPC (old M2–M5/M10). Those sections are deleted on purpose.

## Progress

- [x] (2026-07-23) Read-only feasibility and blast-radius audit completed at `598007aa`.
- [x] (2026-07-23) Initial architecture selected (later superseded): custom Fetch protocol +
  multiplexed child IPC + transport-neutral PTY.
- [x] (2026-07-31) Revalidated at `00ba970e`: bootstrap lifecycle, auth exposure, locator
  reuse, Chat snapshot recovery, Web endpoint consumers, and raw binary/upload traffic.
- [x] (2026-07-31) Development-only protocol and session cookie probes passed; disposable
  source removed. Evidence for custom-scheme mechanics, not completion of M0.
- [x] (2026-08-02) Architecture rewritten: custom-scheme + undici loopback/UDS proxy;
  native cookie-authenticated WebSocket for PTY/`/sync`; delete process IPC framing scope;
  rename connection kind to `owned-proxy` / `attached-http`; effort reduced XL → M–L.
- [ ] M0 packaged Electron feasibility gate.
- [ ] M1–M7 implementation and verification.

## Surprises & Discoveries

- The bootstrap lifecycle is already observable over child IPC. That control channel is
  not an invitation to carry HTTP bodies; transport readiness still composes with
  `listener-establishment`.
- `URL.origin` is not a safe equality primitive for the standard custom scheme; all
  internal endpoint checks need explicit protocol/hostname/port comparison.
- Native WebSocket does not consume Chromium's HTTP/1.1 six-connection pool. The earlier
  plan over-scoped by treating "zero socket" as requiring PTY/`/sync` over process IPC.
- Multiplexed process framing was solving Main↔Server transport aesthetics, not the
  Tearoff pool bug. Custom scheme removes renderer traffic from the pool; undici is enough
  for Main.

## Decision Log

| Date       | Decision | Rationale |
| ---------- | -------- | --------- |
| 2026-07-23 | Reuse ordinary Server HTTP/`app.handle` semantics instead of route RPC. | Preserves Elysia middleware and avoids generated-client contract drift. |
| 2026-07-31 | Keep `attached-http` explicit and retain the HTTP listener. | Locator/CLI/parallel-process cases remain real. |
| 2026-07-31 | Remove renderer bearer arguments; bootstrap cookies in Main. | Static window argv cannot safely express connection-specific credential ownership. |
| 2026-08-02 | **Reject** multiplexed child-process Request/Response framing. | Custom-scheme + undici solves Chromium pool starvation without a private protocol. |
| 2026-08-02 | Rename `owned-ipc` → `owned-proxy`. | Name must not imply process IPC framing; Main proxies HTTP to the existing listener. |
| 2026-08-02 | Keep PTY/`/sync` on native WebSocket with HttpOnly cookie auth. | WS is outside the HTTP/1.1 six-connection pool; IPC duplex was unnecessary risk. |
| 2026-08-02 | v1 undici loopback; v2 optional UDS/named pipe. | Optional zero-TCP is an undici target change, not a framing project. |
| 2026-08-02 | Plan B if M0 fails: local HTTP/2 TLS (separate plan), not IPC framing. | Failed custom-scheme packaging must not resurrect the rejected design. |
| 2026-08-02 | `attached-http` also uses `cradle-server://` when Main can proxy. | Attached Tearoffs hit the same Chromium pool; kind stays attached for ownership. |
| 2026-08-02 | WS base = status `serverUrl`; no v1 `wsBaseUrl` field. | Custom scheme cannot do WS upgrade; loopback HTTP(S) URL is enough. |
| 2026-08-02 | Defer UDS/named pipe until after M7. | Optional zero-TCP; not required to fix pool starvation. |

## Outcomes & Retrospective

This is an architecture rewrite of the plan, not an implementation completion. The product
goal is Tearoff-safe Desktop networking: renderer HTTP/SSE leave Chromium's six-connection
pool via `cradle-server://local`, Main proxies with undici, WebSocket stays native with
Main-owned cookies, and the Server HTTP listener remains the one contract for CLI and
proxy targets.

If M0 passes, execute M1–M7 in order. If M0 fails, stop with artifact measurements and
consider Plan B (local HTTP/2 TLS) as a new plan — do not implement process IPC framing.

> Revision note (2026-07-31): rebased from `598007aa` to current-state facts at
> `00ba970e`, incorporated bootstrap/credential/Chat-snapshot drift, corrected the
> packaged command, and recorded development feasibility evidence.
>
> Revision note (2026-08-02): deleted multiplexed IPC framing scope (contracts package,
> runner Request/Response protocol, Server process host, PTY-over-IPC, old M2–M5/M10).
> Locked architecture is custom-scheme → Main credential injection → undici
> loopback/UDS → existing Elysia listener; native cookie-authenticated WebSocket for
> PTY/`/sync`. Connection kind is `owned-proxy` / `attached-http`. Effort honestly
> reduced from XL to M–L.
