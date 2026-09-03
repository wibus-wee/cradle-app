# Plan 075: Route Desktop Server fetch through Electron Main

This plan is a living document. Keep `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` current while executing it.

Plan 075 succeeds the stopped custom-scheme design in Plan 063. Plan 063 remains
the historical record of that experiment and its packaged-Electron failure; this
plan does not reinterpret its result.

## Purpose / Big Picture

Cradle Desktop can open a main window and many Tearoff windows. Those renderers
currently send requests to the same localhost HTTP/1.1 origin. Long-lived streams
consume Chromium connections, and bursts of otherwise short API requests still
compete in Chromium's per-origin networking machinery. Increasing a limit that
Electron does not expose as a stable product contract is not a solution.

After this work, requests made by the generated OpenAPI client to the
Desktop-managed Cradle Server retain the normal Fetch API at every Web call site,
but the injected `fetch` implementation carries them through Electron IPC. Main
performs the real localhost HTTP request with a bounded, explicitly sized Undici
pool. Response bodies remain streaming and cancellable; they are never accumulated
without a consumer.

The target path is:

```text
generated OpenAPI client / cradleFetch
  -> Desktop fetch-compatible adapter
  -> Electron invoke for request + response head
  -> credit-controlled IPC response chunks
  -> Electron Main Undici Agent
  -> existing localhost HTTP Server
```

This introduces no local TLS, custom certificate, Unix-domain socket, Windows
named pipe, private child-process HTTP implementation, or second Server API.
Browser builds and remote/attached Server traffic continue to use native Fetch.

## Status

- **Priority**: P0
- **Execution**: IN PROGRESS
- **Risk**: Medium
- **Supersedes**: Plan 063 production milestones M1-M7 only
- **Preserves**: existing Elysia routes, generated OpenAPI client, Web mode,
  ticketed PTY and Sync WebSockets, and feature-level response parsing

## Progress

- [x] (2026-08-13) Reproduced the architectural gap in the long-stream-only
  successor: many windows can also create a burst of finite localhost requests.
- [x] (2026-08-13) Selected generated-client Fetch injection rather than a
  per-route IPC command union or a custom socket transport.
- [x] (2026-08-13) Added the shared Desktop fetch IPC protocol and a Main-owned
  broker backed by separate Undici Agents: 128 finite-request connections and
  256 explicitly `Accept: text/event-stream` connections.
- [x] (2026-08-13) Added response-head-first streaming with one-chunk receiver
  credit, a 64 KiB maximum emitted chunk, cancellation, sender ownership checks,
  target-origin validation, and Main-only bearer injection.
- [x] (2026-08-13) Added the preload bridge and Fetch-compatible Web adapter;
  connected `cradleFetch` and the generated client to `owned-ipc` mode.
- [x] (2026-08-13) Passed focused Main/Web tests, both TypeScript projects,
  focused lint, diff hygiene, and the complete Electron production bundle.
- [x] (2026-08-13) Proved 21 simultaneous requests reach a real localhost HTTP
  Server before any response is released, through Main rather than Chromium.
- [x] (2026-08-13) Audited raw Web fetches and moved Chat SSE, Chronicle,
  Chronicle search, plugin devtool, and PDF retrieval through `cradleFetch`.
  Changelog, data-URL export, arbitrary endpoint testing, and multipart asset
  upload intentionally remain native; upload streaming is still open.
- [x] (2026-08-13) Covered cancellation while response headers are pending,
  owner destruction, stale/current generation fencing, credential replacement,
  response header filtering, and authenticated redirect rejection. Abort after
  response headers, upstream error projection, and empty bodies remain follow-up
  coverage rather than blockers for the first integration.
- [ ] Remove the Desktop Server bearer from renderer arguments once every
  first-party credentialed fallback has been migrated or ticketed.
- [x] (2026-08-13) Added an isolated Electron smoke using the production broker,
  preload bridge, and Web Fetch adapter. It creates 21 BrowserWindows, holds all
  finite responses until 21 authenticated requests arrive, and verifies an SSE
  response. Development and packaged Linux plus packaged Windows/release CI are
  wired; all fixture bundles and the Linux unpacked package build locally.
- [ ] Obtain the runtime smoke result on a host with X/DBus (Linux CI) and on
  Windows. This restricted container rejects Electron's DBus connection before
  app code starts, so no local runtime PASS is claimed.
- [x] (2026-08-13) Ran focused integration gates, all three relevant TypeScript
  projects, lint, workflow YAML parsing, smoke/production Electron bundles, the
  Linux unpacked smoke package, and diff hygiene; updated Plan 063/README status.
- [ ] Commit, push, and update the draft PR. The GitHub publish skill requires
  `gh`, which is absent from this environment; no remote mutation is claimed.
- [x] (2026-08-30) Completed Plan 078's document/navigation ownership,
  no-credit lease, renderer cleanup, diagnostics, and isolated actual-Electron
  ten-reload proof. Real-process restart and post-restart memory observation
  remain Plan 078's rollout gate.

## Surprises & Discoveries

- Plan 063 had already centralized generated API requests in `cradleFetch`.
  Its failed component was the packaged `cradle-server://` custom-protocol path,
  not Fetch injection itself.
- A long-stream-only broker is insufficient. Even with SSE removed, many windows
  can issue enough short requests simultaneously to create head-of-line delay in
  Chromium. Moving the generated API transport owner to Main addresses both cases.
- Electron's existing invoke/send bridge is sufficient. A request can return its
  response head via invoke, while a keyed credit channel carries the body. There is
  no need to pass a DOM `Response` or `MessagePort` through `contextBridge`.
- The current environment has no Xvfb binary, so a GUI Electron runtime cannot be
  truthfully claimed here. The production Main, preload, and renderer bundles do
  build successfully.
- A 2026-08-29 live incident found 69 broker requests (66 streams, 3 finite)
  retained for one still-live `WebContents` after renderer document reloads.
  Receiver credit bounded Main reads as designed, but zero credit did not cancel
  upstream. Plan 078 is the corrective lifecycle plan; packaged concurrency
  smoke alone cannot close this gap.

## Decision Log

- **2026-08-13 — Keep localhost HTTP between Main and Server.** The failure is
  Renderer/Chromium connection ownership. Main's configurable Undici pool removes
  that bottleneck without replacing the Server listener.
- **2026-08-13 — Inject Fetch at `cradleFetch`.** The generated client, raw
  first-party helpers, schemas, and React Query integrations keep standard Fetch
  semantics and do not acquire a parallel operation registry.
- **2026-08-13 — Do not monkey-patch `globalThis.fetch`.** Third-party Provider,
  plugin, telemetry, remote-host, and ordinary Internet requests must not silently
  acquire Desktop Server authority.
- **2026-08-13 — Stream every response body.** Buffering the result of
  `ipcRenderer.invoke()` would deadlock SSE and make downloads/uploads scale with
  body size. Invoke returns only the response head.
- **2026-08-13 — Use receiver credit.** Main performs at most one 64 KiB body
  delivery for each renderer credit and retains at most one split remainder. A
  renderer that stops reading therefore stops upstream reads.
- **2026-08-13 — Use `owned-ipc` as an explicit connection kind.** Browser and
  attached HTTP modes retain native Fetch; only Desktop status can authorize the
  transport switch.
- **2026-08-13 — Keep native WebSockets.** PTY and Sync already use audience-bound,
  single-use tickets and do not need to be reimplemented over this fetch carrier.

## Context and Orientation

The generated client is configured in `apps/web/src/lib/client.config.ts` and
already injects `cradleFetch` from `apps/web/src/lib/server-credential.ts`.
Desktop readiness is delivered through `apps/desktop/src/shared/server-runtime.ts`
and applied by `apps/web/src/lib/server-readiness.ts`.

The new shared wire shapes and channel names live in
`apps/desktop/src/shared/server-fetch-transport.ts`. Preload exposes only the
specific open, credit, cancel, and event methods. Main owns the implementation in
`apps/desktop/src/main/server-fetch-broker.ts`.

`DesktopServerFetchBroker` receives only a path/query, never an arbitrary upstream
origin. It resolves that path against the current Server URL, checks the resulting
origin, strips renderer credentials and hop-by-hop headers, and injects the token
read from `server-process.ts`. Requests are keyed by both `webContents.id` and a
renderer-generated request ID.

The Web adapter in
`apps/web/src/lib/server-transport/desktop-ipc-fetch.ts` reconstructs a standard
`Response` with a `ReadableStream`. `pull()` grants one chunk of credit. Stream
cancel and `AbortSignal` notify Main. Therefore existing code using `json()`,
`text()`, `body.getReader()`, or the fetch-backed SSE parser does not need a new
API.

## Plan of Work

### Milestone 1 — Finite and streamed Fetch carrier

Implement and verify the generic request/response carrier. The response head must
arrive without waiting for EOF. No data may be read from the upstream body until
Renderer grants credit. Each delivery is at most 64 KiB. Closing a window,
cancelling a body, aborting the Request, changing Server generation, or shutting
down Desktop must release the upstream reader and AbortController.

Acceptance:

- generated API POST retains path, query, content type, and exact body bytes;
- renderer credentials never reach Main's upstream request;
- Main bearer is present upstream and absent from the response projection;
- 21 simultaneous finite requests all reach a real localhost Server;
- a 64 KiB plus 17-byte response requires two data credits and a later EOF read;
- focused Desktop/Web typecheck, lint, tests, and Electron bundle pass.

### Milestone 2 — Complete first-party fetch coverage

Inventory direct Server `fetch` users. Generated OpenAPI calls are already covered.
Move first-party raw Server API/SSE/download helpers to `cradleFetch`. Do not route
remote-host upstreams, Provider endpoints, telemetry, BrowserPanel traffic, or
arbitrary plugin Internet access through the privileged bridge.

Browser-owned subresources such as `<img src>`, module imports, and navigations are
not Fetch injection call sites. Keep their current ticketed HTTP path initially.
Only add a separate protocol handler if measured pool pressure remains after API
traffic migration; do not revive the failed Plan 063 custom-scheme design by
default.

Acceptance:

- an `rg` inventory classifies every remaining direct Server fetch;
- every migrated caller preserves abort and error behavior;
- no external URL can be rebased or sent through Main;
- Web builds continue to use native Fetch.

### Milestone 3 — Credential removal and lifecycle fencing

Once all credentialed Renderer HTTP has moved behind Main or uses a single-use
ticket, remove `--server-auth-token` from main, Tearoff, and Devtool window
arguments and remove its preload/env projection. Publish and verify a monotonic
Server generation. A generation change rejects old opens and aborts active work.

Acceptance:

- no Desktop renderer receives the long-lived Server bearer;
- stale generation requests fail closed;
- owner destruction leaves zero broker requests;
- attached/remote behavior is explicit and retains no accidental Main authority.

### Milestone 4 — Packaged multi-window proof

Add an isolated packaged smoke that opens the main window plus twenty Tearoffs.
The fake Server holds 21 finite requests until all have arrived, emits a streamed
response only as credit arrives, and records cancellation. Run it on Linux with
Xvfb and on the existing Windows packaged workflow.

Acceptance:

- 21/21 finite requests reach Server without a six-request plateau;
- stream first byte and finite controls complete within their declared timeout;
- paused consumption produces no additional upstream reads;
- window destruction cancels its requests within one second;
- result artifacts are retained on pass and failure.

## Concrete Validation Commands

Run from the repository root:

```bash
node_modules/.bin/vitest run apps/desktop/src/main/server-fetch-broker.test.ts
node_modules/.bin/vitest run --config apps/web/vitest.transport.config.ts \
  apps/web/src/lib/server-credential.test.ts \
  apps/web/src/lib/server-transport/base-url.test.ts
node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.node.json
node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json
node_modules/.bin/eslint \
  apps/desktop/src/main/server-fetch-broker.ts \
  apps/desktop/src/main/server-fetch-broker.test.ts \
  apps/desktop/src/shared/server-fetch-transport.ts \
  apps/web/src/lib/server-transport/desktop-ipc-fetch.ts
(cd apps/desktop && node_modules/.bin/electron-vite build)
git diff --check
```

The pnpm wrapper may attempt to relink the workspace store in restricted execution
environments. Direct workspace binaries are an acceptable local equivalent; CI
must use the repository's normal pnpm scripts.

## Idempotence and Recovery

Registration happens once during `startDesktopApp()`. `setServerUrl()` is
idempotent for the same URL and aborts all active requests before accepting a new
target. `cancel()` and terminal delivery are idempotent. Shutdown cancels active
readers before closing the Undici Agent and Server process.

If the bridge is unavailable or the Desktop status is not `owned-ipc`,
`cradleFetch` uses the existing native Fetch path. This is a platform-mode choice,
not a silent fallback after an IPC request has started. An IPC failure must surface
to the caller; it must never replay a mutating request over HTTP.

## Outcomes & Retrospective

The initial implementation confirms the architectural premise: existing OpenAPI
call sites can remain unchanged, while 21 simultaneous requests reach a real
localhost Server through Main. The implementation also survives the actual
Electron production bundler. Plan 078 now closes the document-lifetime gap with
navigation/crash cancellation, a preload-owned document fence, a no-credit
lease, and deterministic Renderer cleanup. Its isolated actual-Electron smoke
returned four requests to zero after each of ten same-window reloads and closed
all 40 fixture responses. This plan remains in progress for its credential
removal and packaged platform smoke gates; Plan 078 separately retains the
real-process restart and memory-observation rollout gate.
