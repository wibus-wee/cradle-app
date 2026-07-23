# Plan 063: Eliminate Desktop-owned Server sockets with one multiplexed IPC transport

> **Executor instructions**: Read this entire plan before changing source. Execute the
> milestones in order and run every verification gate. Milestone 0 is a mandatory
> packaged-Electron feasibility proof; do not begin the production migration until it
> passes. If a STOP condition occurs, stop and report instead of adding a fallback,
> buffering heuristic, per-route RPC, or compatibility shim. When complete, update this
> plan's row in `plans/README.md` unless the reviewer explicitly owns the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 598007aa..HEAD -- \
>   apps/desktop/src/main \
>   apps/desktop/src/preload \
>   apps/desktop/src/shared/server-runtime.ts \
>   apps/desktop/package.json \
>   apps/server/src/index.ts \
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
>   apps/web/src/env.d.ts \
>   packages \
>   package.json \
>   pnpm-lock.yaml
> ```
>
> Changes are expected because Plan 061 is in progress. Compare every changed transport
> symbol with the current-state facts and invariants below. Transport-only drift may be
> reconciled; any change to Chat admission, completion, cursor, queue, or provider
> ownership is a STOP condition for this plan.

## Status

- **Priority**: P0
- **Effort**: XL, estimated 25-40 engineering days across reviewable milestones
- **Risk**: HIGH
- **Depends on**: Plan 038 (DONE), Plan 040 (DONE), Plan 054 (DONE)
- **Coordinates with**: Plan 061 (IN PROGRESS); this plan changes transport only
- **Category**: migration / tech-debt
- **Planned at**: commit `598007aa`, 2026-07-23

## Decision and confidence

The selected architecture is feasible, but it is not honest to claim 100% implementation
confidence before Electron's packaged runtime has demonstrated streaming, cancellation,
dynamic `import()`, binary bodies, and default-session isolation over the custom scheme.
Those behaviors are version- and packaging-sensitive. Milestone 0 exists to turn the
remaining platform uncertainty into measured evidence before the expensive migration.

The architectural decision is:

```text
Desktop-owned local Server

renderer fetch/subresource
  -> cradle-server://local/... (Electron default-session protocol handler)
  -> Electron main DesktopServerTransport.fetch(Request)
  -> one multiplexed logical request/stream protocol
  -> managed runner relay
  -> Server child process
  -> the existing Elysia app.handle(Request)

renderer chat stream/event tail
  -> existing typed Electron bridge/broker
  -> the same DesktopServerTransport.fetch(Request)
  -> the same multiplexed child-process protocol

renderer PTY
  -> typed Electron duplex bridge
  -> the same multiplexed child-process protocol
  -> transport-neutral Server PTY channel adapter
```

This means one **logical multiplexed Desktop-to-Server transport**, not one global
`ipcRenderer` request and not one channel per Tearoff. The existing supervisor topology
contains two physical OS IPC links, Electron main -> managed runner and managed runner ->
Server. The runner forwards the same versioned envelope in both directions. Removing the
runner merely to claim one physical pipe is out of scope because it owns process-group
shutdown and crash containment; it would not improve the browser connection limit.

For a Server discovered through the locator rather than spawned by this Desktop process,
IPC is impossible. That state is explicitly `attached-http`, keeps the authenticated HTTP
adapter, and does not claim the zero-socket invariant. It must never be silently labeled
or treated as `owned-ipc`.

## Why this matters

Electron's default Chromium session applies the HTTP/1.1 per-origin connection pool to
the main window and all Tearoff windows. Long-lived SSE requests consume those slots, so
opening enough independent Chat, workspace, workflow, Download Center, or plugin streams
can starve ordinary API calls even though every process is local. Sharing only identical
SSE subscriptions cannot solve the general case because different sessions and features
have different upstream streams.

The fix must remove the constrained transport, not raise a limit Chromium does not expose
as a reliable product contract. In Desktop-owned mode, no renderer or Electron-main request
may reach the local Server over HTTP, HTTPS, SSE, or WebSocket. Logical request count may
grow with Tearoffs, but every request is multiplexed over the existing child-process IPC
topology with explicit flow control.

## Current state

### Window and connection topology

- `apps/desktop/src/main/window-manager.ts:100-124` creates Tearoffs without a
  `webPreferences.partition`. They share the default Electron session and therefore the
  same Chromium per-origin connection pool.
- `apps/desktop/src/main/main-app.ts:195-216` and
  `apps/desktop/src/main/window-manager.ts:108-121` pass the long-lived local Server token
  into renderer command-line arguments.
- `apps/desktop/src/preload/index.ts:39-86` parses and exposes `serverUrl` and
  `serverAuthToken`; `apps/web/src/env.d.ts:35-51` makes both part of the renderer contract.
- `apps/desktop/src/shared/server-runtime.ts:4-9` reports a ready Server as only
  `{ state: 'ready', serverUrl }`, so callers cannot distinguish an owned child from a
  reused locator-backed process.

### Requests are concentrated enough to adapt once

- `apps/web/src/lib/client.config.ts:8-21` injects `cradleFetch` into the generated client.
- `apps/web/src/lib/server-credential.ts:13-35` resolves the configured base URL, adds the
  renderer-visible bearer token, and calls global `fetch`.
- The generated client currently exposes 545 exported operations in
  `apps/web/src/api-gen/sdk.gen.ts`. Creating 545 IPC methods would duplicate the HTTP
  contract and make every API evolution a cross-process migration.
- At the planned commit, 32 production Web files reference `getServerUrl()`,
  `getConfiguredServerUrl()`, or `SERVER_BASE`; binary, `FormData`, module, image, PDF,
  and download consumers exist in addition to JSON APIs.
- Seven production files instantiate native `EventSource`:
  `features/chat/session/session-sync-engine.ts`,
  `features/chat/transport/chat-event-tail-transport.ts`,
  `features/chat/workflow/use-workflow-runtime.ts`,
  `features/download-center/transport.ts`, `features/workspace/file-tree.tsx`,
  `features/workspace/global-session-sync-engine.ts`, and `lib/plugin-host.ts`.
- Two production files instantiate native `WebSocket`:
  `features/tui/pty-channel.ts` and `lib/sync-socket/client.ts`.

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

- `apps/web/src/features/chat/transport/chat-stream-transport.ts:77-97` selects the
  Desktop bridge first, then sync WebSocket, then HTTP/SSE.
- `apps/web/src/features/chat/transport/chat-event-tail-transport.ts:36-59` similarly
  selects the Desktop event-tail bridge before sync WebSocket/native `EventSource`.
- `apps/desktop/src/main/chat-stream-broker.ts:417-478` uses `fetch` to open an upstream
  Server response stream.
- `apps/desktop/src/main/chat-event-tail-broker.ts:210-305` shares only an identical
  session/global key and otherwise opens one upstream SSE stream per logical tail.
- Therefore renderer -> Electron is already IPC for Chat, but Electron -> Server is still
  HTTP. Different session Tearoffs still consume distinct Server connections.

The brokers remain useful ownership boundaries and do not need a semantic rewrite. Inject
the new `DesktopServerTransport.fetch` implementation into them. Plan 061 owns Chat run
admission/completion; Plan 054 owns run cursor semantics. This plan must not absorb either.

### A bidirectional Server IPC path is feasible but incomplete

- `apps/desktop/src/main/managed-process.ts:51-83` forks a managed runner with an IPC fd.
- `apps/desktop/src/main/managed-process-runner.ts:46-55` forks the actual Server with a
  second IPC fd.
- `managed-process-runner.ts:111` currently forwards Server messages upward as
  `{ type: 'target-message', message }`; it does not forward owner messages downward.
- `apps/desktop/src/main/server-process.ts:304-322` already receives Server startup
  messages through that relay.
- Both `fork()` calls currently use default JSON serialization. The transport must set
  `serialization: 'advanced'` on both so binary chunks are structured-cloned as
  `Buffer`/`Uint8Array`, never base64 strings.

### The existing HTTP application is the reusable contract

- `apps/server/src/app.ts:144-177` constructs one Elysia app, then installs CORS, request
  identity, and authentication before feature routes.
- `apps/server/src/app.ts:258-483` exports `createServerApp()` and returns that same app.
- `apps/server/src/index.ts:112-149` creates the app and calls `app.listen()`.
- Existing Server tests call `app.handle(new Request(...))`, proving the application can
  execute a standard Fetch request in process.

The IPC host must call `app.handle(Request)`. It must not invoke feature services directly,
or it would bypass auth, validation, CORS, error mapping, remote-session proxying, and the
single public API contract.

### Startup currently performs an HTTP health probe

- `apps/desktop/src/main/server-process.ts:149-218` may reuse a healthy locator-backed
  process. A reused process has no child IPC relationship to this Desktop instance.
- A newly spawned Server is waited on through `waitForServer()`.
- `apps/desktop/src/main/server-process.ts:899-922` polls `/health` with `fetch`, which
  itself violates the final owned-mode zero-TCP invariant.
- `apps/server/src/database/migration-runner.ts:98-103` already publishes startup phases
  over child IPC. Extend this lifecycle with a versioned transport-ready handshake rather
  than polling HTTP for an owned child.

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

## Alternatives considered and rejected

| Alternative | Why it is not the final architecture |
| --- | --- |
| Raise Chromium's six-connection limit | No supported Electron product contract makes this unlimited; flags are brittle and retain socket-per-stream scaling. |
| Give every Tearoff a separate session partition | Multiplies cookies/cache/auth state and only moves the cap per partition; it does not remove resource growth. |
| Share only Chat EventSource instances | Helps identical subscriptions but cannot combine different sessions, workspace files, workflows, downloads, plugin events, PTY, or ordinary fetches. |
| Add one IPC method per HTTP route | Duplicates 545 generated operations plus manual endpoints and creates permanent contract drift. |
| Send whole request/response bodies in one IPC message | Breaks large upload/download paths, cancellation, memory bounds, and streaming latency. |
| Base64 binary bodies | Adds size and CPU overhead and defeats bounded streaming. |
| Use native `EventSource` on the custom scheme | Header, reconnect, and custom-scheme behavior is not a safe cross-platform contract. A fetch-backed SSE adapter is explicit and testable. |
| Convert `cradle-server:` into `ws:` for PTY | No corresponding network origin exists. WebSocket upgrade semantics are not implemented by `protocol.handle`. |
| Bypass Elysia and call domain services over typed IPC | Splits auth/validation/error semantics and makes the Desktop path a second public API. |
| Remove the managed runner | Broadens process-lifecycle risk without changing the logical multiplexing or the browser cap. |

## Target ownership and module boundaries

### New platform-neutral contract package

Create `packages/desktop-server-contracts/` with package name
`@cradle/desktop-server-contracts`. It owns only versioned schemas/types and pure codecs
for the process transport. It must not import Electron, Elysia, Server modules, or Web
code. Follow `packages/chat-runtime-contracts` for workspace package shape and TypeScript
configuration, but use the repository's current Zod version for runtime envelope parsing.

Suggested public surface:

```ts
export const DESKTOP_SERVER_TRANSPORT_VERSION = 1 as const

export type DesktopServerTransportMessage =
  | TransportHello
  | TransportReady
  | RequestOpen
  | RequestBodyPull
  | RequestBodyChunk
  | RequestBodyEnd
  | ResponseHead
  | ResponseBodyPull
  | ResponseBodyChunk
  | ResponseBodyEnd
  | ChannelOpen
  | ChannelInput
  | ChannelOutput
  | ChannelClose
  | Cancel
  | TransportError

export interface TransportAddress {
  generation: number
  requestId: string
}
```

All messages carry `version`, `generation`, and the relevant `requestId` or `channelId`.
Use a discriminated `type` field and validate messages at both process boundaries. Keep
request/response headers as ordered `[string, string][]` tuples. Preserve repeated response
headers, including `set-cookie`, rather than projecting headers into a plain object.

### Desktop transport owner

Create a deep module under `apps/desktop/src/main/desktop-server-transport/`:

- `connection.ts` owns the discriminated owned/attached connection and generation.
- `process-transport.ts` multiplexes requests/channels over the managed child.
- `fetch-adapter.ts` exposes `fetch(request: Request): Promise<Response>`.
- `protocol-handler.ts` owns `cradle-server://local` validation and default-session
  registration.
- `index.ts` exports the narrow surface consumed by `main-app.ts`, brokers, and services.

Consumers receive a `DesktopServerTransport` dependency. They must not inspect child
messages or choose credentials themselves.

### Server transport owner

Create `apps/server/src/desktop-transport/`:

- `process-host.ts` validates transport envelopes and owns active request/channel maps.
- `request-adapter.ts` reconstructs a standard `Request`, calls `app.handle`, and serializes
  a standard `Response`.
- `pty-channel-adapter.ts` adapts the existing PTY service to a transport-neutral duplex
  channel without moving PTY business semantics.
- `index.ts` installs and stops the host around the existing app lifecycle.

The host is transport infrastructure, not a new feature namespace. Database and business
logic remain in their current Server modules.

### Web transport owner

Keep `cradleFetch` as the generated client's fetch hook. In Desktop-owned mode its runtime
base URL becomes `cradle-server://local`; in browser/attached mode it retains HTTP(S).
Create a fetch-backed SSE adapter under `apps/web/src/lib/server-transport/` and route all
native EventSource sites through it. Keep feature parsers and cursor ownership in their
current feature modules.

PTY receives one transport-neutral interface with HTTP/WebSocket and Desktop IPC
implementations. The UI component must not know which is active.

## Required connection model

Replace `startServer(): Promise<string>` with a discriminated result. Exact naming may
follow current conventions, but the semantics are fixed:

```ts
export type DesktopServerConnection =
  | {
      kind: 'owned-ipc'
      serverUrl: string // listener/CLI locator and diagnostics only
      rendererBaseUrl: 'cradle-server://local'
      generation: number
    }
  | {
      kind: 'attached-http'
      serverUrl: string
      rendererBaseUrl: string
    }
```

- `owned-ipc` means this Desktop instance created the child and completed a matching
  versioned ready handshake. All Desktop UI and main-process Server calls use IPC.
- `attached-http` means `readHealthyLocatedServerUrl()` found another live process. It has
  no IPC channel; HTTP remains explicit.
- Server restarts increment `generation`. Pending operations from the old generation fail.
- Do not automatically fall back from a broken `owned-ipc` transport to loopback HTTP. A
  silent fallback would reintroduce the exact failure this plan exists to eliminate.
- `serverUrl` may still be written to the CLI locator so external CLI clients can use the
  listener. The zero-socket invariant concerns Desktop renderer/main traffic to the owned
  Server, not Server-owned remote calls or explicitly external CLI clients.

`DesktopServerStatus` must expose the connection kind and the renderer endpoint. Web
readiness must use the ready status directly in Electron; it must not probe `/health`.

## Process protocol semantics

### Handshake and readiness

1. Main creates generation `g`, attaches the bidirectional relay, and sends `hello` with
   supported version(s).
2. Runner validates only the outer managed-process envelope and forwards the inner
   transport message unchanged.
3. Server creates the Elysia app, installs the process host against that exact app, and
   completes normal startup/listen readiness.
4. Server returns `ready` with selected protocol version and generation.
5. Main marks `owned-ipc` ready only when generation/version match. Startup phase messages
   remain separate and continue to update the loading UI.

The owned-mode readiness path performs no HTTP health fetch. A focused IPC health request
through `app.handle` may run after the handshake as a parity assertion, but it travels over
the process transport.

### Request and response mapping

- Accept only `cradle-server://local/...`; reject credentials, ports, other hosts, and
  malformed URLs.
- Convert the custom URL to the canonical internal HTTP URL before `app.handle` so Elysia
  route and URL semantics remain unchanged.
- Preserve method, query, ordered headers, and body bytes. Never forward a renderer-supplied
  `authorization`, `cookie`, `proxy-authorization`, or Cradle credential header in owned
  mode. Main injects the current Server bearer credential into the internal Request.
- For a streamed Node `Request` body, set the runtime-required duplex option in the Server
  adapter. Do not buffer `FormData` or upload bodies to discover content length.
- Preserve response `status`, `statusText`, headers, and body. A body-less HEAD/204/304
  response remains body-less.
- Redirect behavior must match fetch. Do not let a redirect escape to an arbitrary scheme
  without the existing web security policy.

### Pull-based flow control

No byte-count queue heuristic is allowed. Each direction is credit/pull driven:

```text
Server Request.body pull()
  -> request-body-pull
  -> Main reads at most one source chunk
  -> request-body-chunk | request-body-end

Electron protocol Response.body pull()
  -> response-body-pull
  -> Server reads at most one app Response chunk
  -> response-body-chunk | response-body-end
```

There is at most one unfulfilled pull per logical body direction unless the protocol later
adds explicit integer credit. Transport only `Buffer`/`Uint8Array`; do not convert large
bodies to JSON arrays or base64. Empty chunks do not create unbounded spin.

### Cancellation and failure

- Renderer request abort cancels the main request reader, sends `cancel`, aborts the Server
  Request signal, and cancels the Server response reader.
- Consumer cancellation of a response stream performs the same cleanup.
- Server-side errors before response headers map through the existing Elysia error handler
  whenever possible. Transport corruption is a distinct deterministic transport error.
- On child exit/restart, reject every old-generation pending request/channel exactly once,
  release readers/listeners, and increment generation.
- Never automatically replay a mutation. Reads may be retried only by existing caller-level
  policy after a new ready generation.
- Late chunks from an old generation or canceled request are ignored and counted, not
  attached to a new request with the same local id.

### PTY duplex channel

`protocol.handle` cannot implement WebSocket upgrade semantics. Extract the connection
adapter around the existing PTY hub/service while preserving:

- existing start/attach/stop route ownership;
- input, resize, ping/pong, snapshot, output, exit, and error frames;
- `fromSeq` resume and timeline replay semantics;
- shell lease attach/detach counts and cleanup;
- one close notification and generation fencing.

The browser/attached implementation continues to use WebSocket. Desktop-owned mode selects
the typed preload bridge and carries PTY frames as logical channel messages over the same
child-process transport. Do not emulate a WebSocket class or duplicate PTY state in main.

The general `/sync` WebSocket remains available for browser/attached mode. In owned mode,
the existing Desktop chat brokers take precedence and all other migrated event consumers
use fetch-backed SSE; add a test/ratchet proving `/sync` is never opened against an
`owned-ipc` connection.

## Security invariants

1. The renderer never receives the Desktop-owned Server's long-lived bearer token.
2. The custom protocol handler accepts only the exact `local` authority and app default
   session. BrowserPanel partitions are not registered.
3. Every IPC HTTP request still runs through Elysia auth, validation, CORS, request-id,
   error mapping, and route middleware.
4. Main injects credentials after stripping renderer-controlled credential headers.
5. Transport envelopes are schema-validated at main, runner, and Server boundaries. Invalid
   or wrong-version messages fail closed and never reach a feature handler.
6. Request ids, URLs, status, sizes, duration, and cancellation reason may be observed;
   authorization headers, cookies, request bodies, response bodies, and PTY contents may
   not be logged.
7. Remote-host proxy behavior inside the Server remains Server-owned and continues to obey
   Plan 038 credential-audience rules.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Contract package | `pnpm --filter @cradle/desktop-server-contracts typecheck` | exit 0 |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0, including boundary checker |
| Server boundary | `pnpm --filter @cradle/server check:boundaries` | exit 0 |
| Desktop typecheck | `pnpm --filter @cradle/desktop typecheck` | exit 0 |
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Focused Desktop tests | `pnpm exec vitest run apps/desktop/src/main/managed-process.test.ts apps/desktop/src/main/desktop-server-transport --maxWorkers=1` | all pass |
| Focused Server tests | `pnpm --filter @cradle/server exec vitest run src/desktop-transport src/modules/pty --maxWorkers=1` | all pass |
| Focused Web tests | `pnpm --filter @cradle/web exec vitest run src/lib/server-transport src/features/tui src/features/chat/transport --maxWorkers=1` | all pass |
| Server suite | `pnpm --filter @cradle/server test` | all pass or only recorded pre-existing failures |
| Web suite | `pnpm --filter @cradle/web test` | all pass |
| Root suite | `pnpm test` | all pass or only recorded pre-existing failures |
| Lint | `pnpm lint` | exit 0 or only recorded pre-existing failures |
| Packaged runtime | `pnpm build:desktop` | exit 0 |
| Diff hygiene | `git diff --check` | no output |

If a listed focused test file does not exist yet, create it in the milestone that first
names it. Record the exact pre-existing full-suite baseline before editing; never relabel a
new failure as baseline.

## Scope

**In scope**:

- New `packages/desktop-server-contracts/` package and workspace dependency wiring.
- Bidirectional, advanced-serialization relay in
  `apps/desktop/src/main/managed-process.ts` and `managed-process-runner.ts`.
- Server process host under `apps/server/src/desktop-transport/` and lifecycle wiring in
  `apps/server/src/index.ts`/`app.ts` as needed.
- Desktop transport owner under `apps/desktop/src/main/desktop-server-transport/`.
- `cradle-server` privileged scheme registration before app readiness and a handler on
  `session.defaultSession` only.
- `DesktopServerConnection`, `DesktopServerStatus`, startup, crash/restart, and shutdown
  changes in Desktop main/shared/preload/Web environment contracts.
- Injection of the shared transport into Desktop chat brokers, plugin source sync, tray,
  notification, preferences, observability, readiness, and every other main-process call
  whose destination is the Cradle Server.
- Web base-URL/fetch adapter changes, fetch-backed SSE migration, binary/FormData/module/
  image/PDF parity, and removal of the Desktop-owned token from renderer arguments.
- A transport-neutral PTY duplex adapter and Desktop bridge preserving existing semantics.
- A static transport-boundary ratchet and a targeted Electron packaged smoke test.
- Documentation in affected Desktop, Server, Web, Chat, and PTY module READMEs.

**Explicitly out of scope**:

- Changing Chat admission, completion, queueing, durable facts, provider lifecycle, or
  cursor semantics owned by Plans 061 and 054.
- Replacing Elysia routes with feature RPC methods.
- Changing database schema or adding a transport table.
- Removing the HTTP listener or CLI locator. External CLI and explicit attached clients
  may still use HTTP.
- Moving Server-owned remote HTTP/WebSocket calls onto Desktop IPC.
- Installing the custom protocol handler in BrowserPanel partitions.
- Reworking relay, remote-host, plugin ownership, Download Center ownership, or PTY
  business semantics.
- Generic browser UI E2E work. Only a transport-focused Electron smoke is justified.
- Silent HTTP fallback for an owned child.

## Git workflow and delivery slices

- Suggested branch: `advisor/063-eliminate-desktop-server-sockets`.
- Preserve unrelated operator changes. At planning time these files are dirty and outside
  transport scope: `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts`,
  its test, and `apps/server/src/modules/chat-runtime/lifecycle/cancel.ts`.
- Use conventional commit messages consistent with the repository.
- Deliver in independently reviewable slices after Milestone 0:
  1. contracts + managed-process relay;
  2. Server host + main fetch transport;
  3. protocol handler + generated/raw fetch migration;
  4. SSE + Desktop main consumer migration;
  5. PTY duplex + credential removal;
  6. ratchet + packaged stress verification + docs.
- Do not push or open a PR unless the operator instructs it.

## Milestones

### M0 - Prove Electron 42 behavior in development and packaged mode

Build a minimal test fixture using the proposed privileged scheme and
`session.defaultSession.protocol.handle`. It may live under
`apps/desktop/src/main/desktop-server-transport/fixtures/` and must use a fake transport,
not production Server logic. Prove all of the following in both `electron-vite` development
and a packaged `pnpm build:desktop` artifact:

- fetch GET/POST and non-2xx `Response` status/headers;
- streamed response first-byte delivery without whole-body buffering;
- renderer cancellation invokes response-stream `cancel`;
- streamed request body where supported by renderer fetch;
- at least a 64 MiB binary download with bounded process memory;
- `FormData` upload preserves multipart bytes/content type;
- `<img src="cradle-server://local/...">` loads;
- dynamic `import('cradle-server://local/.../web.mjs')` evaluates a module;
- a PDF/binary response remains readable by its real consumer or a representative fixture;
- the handler is available in the default app session and unavailable in a BrowserPanel
  partition.

Capture automated assertions, not screenshots. Measure main/renderer RSS before and during
the 64 MiB transfer; steady-state growth must remain bounded by a documented small number
of chunks rather than body size.

**Verify**: focused fixture tests pass and `pnpm build:desktop` exits 0. Store the exact
command and measured result in this plan's Progress section when executing.

**Gate**: if any required custom-protocol behavior cannot be made reliable in the packaged
artifact using supported Electron APIs, STOP. Do not start the production migration and do
not replace it with hidden buffering.

### M1 - Freeze HTTP/IPC parity and connection ownership with characterization tests

Before changing transport, add reusable request/response fixtures against the existing
`app.handle(Request)` path and HTTP listener. Cover JSON, typed errors, redirects, empty
bodies, repeated headers, SSE, binary range/full responses, multipart upload, abort before
headers, abort mid-body, and slow-consumer backpressure. Add current connection-mode tests
for new child versus reused locator.

Add a test-only socket ownership recorder for the future Electron smoke. It must identify
connections by process and destination, not merely count browser DevTools entries.

**Verify**: the new parity suite proves the current HTTP behavior and fails if a fixture
response is buffered, altered, or loses cancellation.

### M2 - Add the versioned transport-contract package

Create `@cradle/desktop-server-contracts` with Zod schemas and inferred types for handshake,
request/response streaming, cancellation, errors, generation, and logical duplex channels.
Add pure tests for every envelope, unknown versions/types, invalid ids, negative credit,
oversized metadata, and binary payload acceptance. Set conservative metadata limits;
payload size is bounded by the pull protocol/chunk producer, not by base64 parsing.

Its `package.json` must define working `typecheck` and `test` scripts so the package can be
verified independently with the commands in this plan; do not rely on an implicit root-only
TypeScript build.

Add the workspace dependency to Desktop and Server only. Web must not import process-level
transport messages.

**Verify**: contract typecheck/tests pass; `rg -n 'electron|elysia|apps/' packages/desktop-server-contracts`
returns no imports into app/framework code.

### M3 - Make the managed runner relay bidirectional and binary-safe

Extend `ManagedChildProcess` with one typed target-message send method rather than exposing
arbitrary raw `child.send` usage to all callers. Configure `serialization: 'advanced'` on
both nested forks. In the runner, accept only the managed outer envelope, validate it, and
forward the inner message to a fork target. Spawn targets have no IPC child and must reject
target sends deterministically.

Preserve existing `started`, `stopping`, `error`, `exit`, process-group kill, and stdout/
stderr behavior. Handle disconnected channels and failed `send` callbacks without throwing
an unhandled exception.

**Verify**: a fixture grandchild echoes typed binary frames in both directions byte-for-byte;
tests cover spawn rejection, disconnect during send, stop during traffic, and no duplicate
listeners after restart.

### M4 - Host `Request -> app.handle -> Response` in the Server child

Install the Server process host against the exact app returned by `createServerApp()`. Keep
normal listener startup for CLI/attached clients, but publish transport readiness over IPC.
Reconstruct request bodies as pull-driven `ReadableStream`s and connect cancellation to an
`AbortController`. Stream the app response only when main sends response credit.

Do not bypass `createAuthPlugin`. Main's internal request must use the existing owned Server
credential, so parity tests exercise auth success and rejection exactly as HTTP does.

On shutdown, cancel all active requests/channels before stopping the app. Bound active map
cardinality with lifecycle cleanup, not an arbitrary low concurrency cap.

**Verify**: parity fixtures from M1 pass through the process host. Tests prove one slow
consumer does not block unrelated requests, a canceled request releases both readers, and
malformed/wrong-generation messages never call `app.handle`.

### M5 - Build the main-process fetch adapter and generation lifecycle

Implement `DesktopServerTransport.fetch`. Serialize Request metadata, expose its body to
Server pull messages, reconstruct the Response head/body, and honor abort in both
directions. Keep per-request state private to the transport module.

Refactor `startServer()` to return `DesktopServerConnection`. A spawned child becomes
`owned-ipc` only after the ready handshake. A reused locator is `attached-http`. Replace the
owned child HTTP health loop with the IPC readiness gate. On restart, invalidate the old
generation and publish starting/ready status again.

Inject this fetch adapter into both chat brokers first. Do not alter their renderer-facing
frame semantics or Plan 061 lifecycle behavior.

**Verify**: fetch adapter tests cover all M1 fixtures, restart during GET, restart during
mutation, stale generation frames, request-id reuse across generations, and abort races.
Chat broker suites pass unchanged except for their injected upstream implementation.

### M6 - Register and serve `cradle-server://local` on the default session

Create a tiny scheme-registration module imported synchronously by
`apps/desktop/src/main/index.ts` before `main-app` can reach `app.ready`. Register only the
required privileges: `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, and `stream`;
add `codeCache` only if M0 proves it is required for plugin modules. Never enable
`bypassCSP`, service workers, or extension access without a separate security review.

After Electron readiness and before app windows issue Server requests, install one handler
on `session.defaultSession`. Validate the exact scheme/host, strip credential headers,
delegate to the current transport generation, and return a standard Response. Do not
install a handler on `session.fromPartition(...)` BrowserPanel sessions.

Publish `DesktopServerStatus` with the connection discriminant. In owned mode, Web runtime
base URL is `cradle-server://local`; in attached mode it remains the explicit HTTP URL.
Keep persisted user-entered endpoint validation HTTP(S)-only; the custom scheme is an
internal runtime value, not a setting users can store.

**Verify**: M0 fixture becomes a production-handler integration test; invalid authorities
fail closed; default-session and partition isolation tests pass; Desktop and Web typecheck.

### M7 - Route every Electron-main Server call through the transport

Replace ambient Server-bound `fetch` calls with injected `DesktopServerTransport.fetch` in:

- `main-app.ts` desktop preferences;
- `plugin-source-sync.ts`, including dev-session events;
- `observability-reporter.ts`;
- `tray-manager.ts`;
- `notification-center-manager.ts` and both chat brokers;
- Server readiness/restart diagnostics in `server-process.ts`.

Audit every match from `rg -l 'fetch\(' apps/desktop/src/main`. Explicitly exclude
`browser-manager.ts` local browser-target probing, which is not Desktop -> Cradle Server
traffic. Document every other exclusion next to the boundary ratchet.

**Verify**: unit tests inject a fake transport and assert no Server consumer reaches global
`fetch` in `owned-ipc`. A static check has an exact allowlist for non-Server main-process
fetches and rejects new unclassified matches.

### M8 - Move generated, raw, binary, and subresource Web traffic to the custom base

Teach the Web endpoint runtime to distinguish internal `cradle-server://local` from stored
HTTP(S) endpoints. `cradleFetch` must preserve Request objects and bodies when rebasing.
The generated client continues to use its existing fetch hook; do not edit generated files
manually and do not add generated-operation IPC methods.

Audit all 32 planned-at URL consumers and the raw-fetch allowlist. Exercise actual paths for:

- generated JSON reads/mutations and typed errors;
- `FormData` uploads;
- assets/images and Chronicle frames;
- session ZIP and other binary downloads;
- workspace PDF preview;
- plugin `web.mjs` dynamic import and revision query;
- range/cache/content-disposition behavior where currently used.

External URLs such as changelog content and data URLs must continue using ordinary fetch.
Do not rewrite every `fetch` mechanically; classify destinations and route only Cradle
Server requests through the existing Server transport boundary.

**Verify**: Web boundary/typecheck tests cover URL selection for owned, attached, browser,
external, and data URL cases. M1 parity and M0 subresource/module fixtures pass through the
production handler.

### M9 - Replace every owned-mode native EventSource with fetch-backed SSE

Create one fetch-backed SSE transport that accepts `Request`, `AbortSignal`, reconnect
policy, event name/id/retry fields, and last-event/cursor construction supplied by the
feature owner. Use a standards-compliant parser already present in the dependency graph if
available; do not hand-roll frame parsing unless existing Cradle code is first extracted
and fully characterized.

Migrate the seven direct EventSource sites. Preserve each feature's existing event name,
snapshot-before-events, reconnect, cursor, parse-error, and disposal behavior. Chat
Desktop bridges may remain because they already provide useful main-owned fanout, but their
upstream fetch must be the M5 transport. Native EventSource remains available only for the
browser/attached adapter where required.

**Verify**: tests cover CRLF/LF frames, multiline data, comments/heartbeats, id/retry,
split UTF-8 chunks, abort, reconnect, cursor resume, malformed payload ownership, and no
reconnect after disposal. `rg -n 'new EventSource' apps/web/src --glob '!**/*.test.*'`
returns only an explicitly documented non-owned adapter, never an owned-mode call path.

### M10 - Carry PTY duplex traffic over the same process transport

Define a transport-neutral PTY channel interface at the PTY module boundary. Adapt the
existing WebSocket handlers and the new process channel to that interface. Add a narrow
preload bridge with schema-validated open/send/close methods and output events. Select it
only for `owned-ipc`; keep WebSocket for browser/attached mode.

Do not move PTY runtime/timeline state into Desktop main. Preserve `fromSeq`, reconnect,
lease, input, resize, ping/pong, output, snapshot, exit, and error semantics. A Server
restart closes the old generation once; the renderer reconnects through existing policy
and resumes from its last acknowledged sequence.

Add a guard proving the general `/sync` WebSocket is not selected in owned mode. Do not
reimplement `/sync` over process IPC unless a real owned-mode consumer remains after the
SSE/chat migrations; if one remains, STOP and inventory its channel semantics before
expanding scope.

**Verify**: PTY tests run the same conformance suite against WebSocket and process-channel
adapters. Test output burst backpressure, input during reconnect, resume without duplicate
output, server restart, normal exit, and renderer destruction.

### M11 - Remove the Desktop-owned credential from renderer arguments

Remove `--server-auth-token` from main and Tearoff `additionalArguments` for owned mode,
then remove `serverAuthToken` from preload and Web environment types for that mode. Main is
the credential owner and injects it only into the internal Request sent to `app.handle`.
Owned mode does not call `/auth/browser-session` or mint EventSource/WebSocket tickets.

Preserve attached/browser authentication explicitly. If the current static argument cannot
be removed without breaking attached mode, introduce a mode-scoped credential bootstrap
owned by main; do not weaken attached auth and do not expose the owned credential merely to
share code paths.

**Verify**:

```bash
rg -n -- '--server-auth-token|serverAuthToken' \
  apps/desktop/src/main apps/desktop/src/preload apps/web/src
```

returns no owned-mode credential exposure. Security tests prove renderer-supplied auth is
stripped, main injection succeeds, and BrowserPanel content cannot call the custom scheme.

### M12 - Add the ratchet and targeted many-Tearoff packaged smoke

Add a transport-boundary checker that classifies all Cradle Server network constructors in
Desktop/Web production code. It must fail on a new owned-mode:

- `http://`/`https://` Server URL passed to renderer fetch;
- native `EventSource`;
- native `WebSocket`;
- Electron-main global fetch to the owned Server;
- credential argument/exposure;
- per-route process message that bypasses the generic Request/Response or PTY adapter.

Create one targeted Electron integration smoke, not a generic UI E2E. In a packaged-like
runtime:

1. start a Desktop-owned Server;
2. open the main window plus at least 20 Tearoffs across distinct sessions;
3. keep more than six independent Chat/event streams active;
4. perform concurrent JSON mutations, binary reads, one upload, and one PTY session;
5. cancel streams, close half the windows, restart the Server, and resume cursor-aware reads;
6. record process/socket ownership and transport diagnostics.

The smoke must assert the invariant below rather than merely observe that the UI appears
responsive. Add transport diagnostics with active request/channel counts, generation,
bytes/chunks, and cancellation totals, but no sensitive contents.

**Verify**: all commands in "Commands you will need" pass, the packaged smoke passes on
the release platforms available in CI, and `git diff --check` is empty.

## Test plan

### Contract and relay

- Schema round-trip for every message type and protocol version.
- Unknown type/version, malformed ids, invalid generation, metadata limit, and binary type.
- Two-hop runner echo with advanced serialization.
- Send/disconnect/exit races and exactly-once cleanup.

### Fetch parity

- GET/POST/PATCH/DELETE/HEAD and query preservation.
- JSON success plus existing 400/401/403/404/409/500 error mapping.
- Empty, text, JSON, binary, multipart, 64 MiB streaming, range, redirect, and repeated
  header responses.
- Abort before headers, mid-request, mid-response, after end, and simultaneous child exit.
- Slow producer, slow consumer, and many concurrent logical streams proving one stream
  cannot head-of-line block all others at the application protocol layer.
- Auth middleware is executed; an uncredentialed internal request is rejected.

### Connection lifecycle

- Spawned child selects `owned-ipc`; locator reuse selects `attached-http`.
- Owned readiness uses no TCP health request.
- Wrong handshake version never publishes ready.
- Restart changes generation and rejects old pending mutations without replay.
- Old chunks cannot settle a new-generation request.
- Shutdown drains/cancels active maps and removes listeners.

### Electron protocol

- Exact scheme/host validation and credential-header stripping.
- Default-session availability and BrowserPanel partition denial.
- Fetch, image, PDF/binary, module import, FormData, streaming, and cancellation in both dev
  and packaged builds.
- Renderer cannot observe the owned Server token through argv, preload, headers, errors,
  logs, or diagnostics.

### Streams and PTY

- SSE parser conformance, split chunks, cursor reconnect, cancellation, and disposal.
- Existing Chat broker fanout/dedup behavior with the new injected upstream fetch.
- Plan 054 cursor/resume regression suites unchanged.
- PTY WebSocket/process adapter conformance, `fromSeq`, leases, burst output, resize/input,
  ping/pong, exit, reconnect, restart, and destroyed renderer.
- `/sync` WebSocket constructor not reached in owned mode.

### Stress and resource bounds

- At least 20 distinct Tearoffs and more than six simultaneous long-lived streams.
- Zero owned-Server TCP connections from renderer and Electron main throughout the test.
- One logical main-to-Server transport generation, relayed over the two expected process
  IPC hops.
- Active request/channel counts return to baseline after windows close.
- Memory does not scale with total upload/download body size; record a numeric threshold
  established by M0 and apply it in CI with platform allowance.

## Required runtime invariant

For Desktop-owned local Server and every Tearoff count `N >= 0`:

```text
renderer -> owned Server HTTP/SSE connections       = 0
renderer -> owned Server WebSocket connections      = 0
Electron main -> owned Server TCP connections       = 0
Desktop -> Server logical process transports        = 1 per generation
logical requests/streams multiplexed on transport   = unbounded by browser host cap
```

The managed runner means the one logical transport crosses two physical IPC hops. Record
both expected IPC fds in diagnostics so a future executor does not mistake the relay for a
second logical transport.

## Done criteria

All boxes must be machine-verified:

- [ ] M0 passes in both development and packaged Electron 42.4.1 with bounded streaming,
  cancellation, binary, FormData, image, PDF, module import, and session isolation.
- [ ] `DesktopServerConnection` cannot represent a locator-backed process as `owned-ipc`.
- [ ] Owned startup/readiness/restart performs no HTTP health probe or silent HTTP fallback.
- [ ] Generated and hand-written Server fetches preserve status, statusText, headers,
  errors, binary bodies, multipart bodies, streaming, and cancellation versus HTTP.
- [ ] Elysia auth/validation/CORS/request-id/error middleware runs on IPC requests.
- [ ] Large upload/download paths are pull-streamed as binary chunks, never whole-buffered
  or base64 encoded.
- [ ] Every Desktop main Server consumer uses one injected transport.
- [ ] Every owned-mode SSE consumer uses a fetch-backed or existing Desktop IPC adapter;
  no native EventSource opens an owned Server connection.
- [ ] PTY uses the same process transport in owned mode and preserves `fromSeq` semantics.
- [ ] `/sync` WebSocket is not opened in owned mode.
- [ ] BrowserPanel partitions cannot resolve `cradle-server://local`.
- [ ] Attached/browser HTTP behavior and authentication remain functional and explicitly
  identified as not satisfying the owned zero-socket invariant.
- [ ] The renderer no longer receives the Desktop-owned Server bearer token.
- [ ] Restart rejects pending mutations without automatic replay; cursor-aware reads can
  recover through existing feature policy.
- [ ] The boundary ratchet rejects new owned Server HTTP/SSE/WebSocket call sites.
- [ ] The 20-Tearoff packaged smoke proves all four connection-count assertions and active
  transport state returns to baseline after cleanup.
- [ ] Contract, Server, Desktop, and Web typechecks pass.
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
- `app.handle(Request)` does not preserve required auth, validation, error, streaming, or
  cancellation behavior for a parity fixture.
- Either nested `fork()` cannot carry binary chunks safely with advanced serialization or
  the runner cannot relay bidirectionally without breaking process-group shutdown.
- A correct implementation requires whole-body buffering, base64 payloads, an arbitrary
  queue-size heuristic, or one IPC method per Elysia route.
- A locator-backed Server is encountered where the implementation assumes owned IPC.
- PTY cannot be separated from `ElysiaWS` through an adapter without changing terminal
  runtime/timeline/lease semantics.
- An owned-mode consumer still requires `/sync` after the migration; inventory and design
  its channel contract before extending this plan.
- The work requires a database schema change.
- The executor would need to modify Plan 061 Chat admission/completion/queue ownership or
  Plan 054 cursor semantics rather than only transport adapters.
- BrowserPanel partitions must receive the custom protocol handler to make an app feature
  work; that is a security-boundary change requiring separate review.
- A verification gate fails twice after a reasonable correction, or the planned-at
  current-state facts have materially drifted.

## Maintenance notes

- Treat the process protocol as a private versioned transport, not a second API. New Server
  routes automatically travel through `Request -> app.handle -> Response` with no contract
  message changes.
- Keep one pull outstanding per body direction. Any future credit-window optimization must
  be benchmarked and versioned; do not add magic queue caps casually.
- Preserve the owned/attached distinction in logs, diagnostics, settings, and bug reports.
  A successful attached HTTP run is not evidence for the zero-socket invariant.
- Reviewers should scrutinize cancellation, generation fencing, repeated headers, auth
  injection, partition isolation, and cleanup more than happy-path JSON calls.
- Plan 028 intentionally used Desktop-main HTTP because no Server IPC path existed. This
  plan supersedes that transport limitation while preserving Plan 028's plugin ownership.
- The HTTP listener remains useful for CLI and attached clients. Removing it is a separate
  product decision and is not necessary to eliminate the Tearoff connection limit.

## Progress

- [x] (2026-07-23) Read-only feasibility and blast-radius audit completed at `598007aa`.
- [x] (2026-07-23) Architecture selected: custom Fetch protocol + multiplexed child IPC +
  transport-neutral PTY, with explicit `owned-ipc`/`attached-http` distinction.
- [ ] M0 packaged Electron feasibility gate.
- [ ] M1-M12 implementation and verification.
