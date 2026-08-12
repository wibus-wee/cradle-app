# Plan 063 Web/auth/ratchet exploration handoff (Exploration C)

Date: 2026-08-13
Repository: `cradle-app`
Inspected HEAD: `9f5f731` (`agent/replan-desktop-server-transport`)
Implementation baseline named by the plan: `d40f895e`
Scope: read-only exploration of the Web runtime base, `cradleFetch`, fetch-backed SSE,
WebSocket/resource tickets, plugin/image/PDF/subresource paths, renderer bearer removal,
the static transport ratchet, and the packaged many-Tearoff smoke. No production source
was modified by this exploration.

## Outcome

Plan 063 is accurately marked “M5 scaffold only.” The Web scaffold has useful seams, but
it cannot currently select `cradle-server://local` in a running Desktop because Desktop
never publishes a connection projection and no Electron protocol handler exists. Even
after Desktop supplies that projection, several Web consumers would still bypass the
adapter or mint the wrong kind of credential. The fetch-backed SSE implementation is in
production use but has only two narrow tests and fails multiple required conformance and
cleanup invariants. Renderer bearer exposure is unchanged. No cross-stack transport
ratchet, M0 packaged protocol fixture, socket-ownership recorder, or 20-Tearoff smoke
exists.

The highest-priority Web/auth defects are:

1. `apps/web/src/features/chat/commands/chat-response-command.ts` captures
   `const SERVER_BASE = getServerUrl()` at module evaluation and uses ambient `fetch` for
   response, quick-question, session-stream, and side-conversation SSE requests. In
   Desktop, modules can evaluate before `waitForDesktopServer()` applies the ready
   projection, so this value remains the preload/default HTTP URL. Quick-question and
   side-conversation paths also run in Electron without the Desktop chat broker. These
   requests can therefore keep using the renderer HTTP/1.1 pool after readiness.
2. `apps/web/src/lib/authenticated-server-url.ts` always calls
   `postAuthResourceTicket()` and appends `resourceTicket`, even when its resolved URL is
   `cradle-server://local`. Owned-proxy modules/resources must instead return the custom
   URL directly and mint no ticket.
3. Several Server-bound raw fetches do not use `cradleFetch`: asset upload, Chronicle
   helpers, Chronicle search, devtool plugin reads, workspace PDF reads, and the Chat raw
   commands above. A custom URL alone does not supply Main-owned authentication unless
   every request reaches the protocol path and Main injects the bearer; these call sites
   also evade a single audited transport seam.
4. `cradleFetch` strips `authorization`, `cookie`, and `proxy-authorization`, but not the
   Server-recognized `x-cradle-token` and `x-cradle-relay-token` headers exported as
   `CRADLE_TOKEN_HEADER` and `CRADLE_RELAY_TOKEN_HEADER` by
   `apps/server/src/http/auth.ts`. Both renderer and Main boundaries must strip the entire
   credential set before Main injects the current bearer.
5. The SSE adapter ignores empty `id:` reset, cannot remove object listeners by identity,
   resets reconnect attempt/backoff as soon as headers open, and does not explicitly
   cancel/release response readers on close, reconnect, or late response resolution. Its
   tests do not prove signal propagation or reader cancellation.

These are completion gaps, not reasons to change the locked architecture. The architecture
remains custom scheme -> Main credential injection -> undici -> existing Elysia HTTP,
with native PTY and `/sync` WebSockets using fresh scoped single-use tickets.

## Current topology and exact scaffold state

### Runtime base and readiness

`apps/web/src/lib/server-transport/base-url.ts` already defines:

- `CRADLE_SERVER_LOCAL_BASE = 'cradle-server://local'`;
- `applyDesktopServerReadyEndpoint()`;
- distinct renderer and network bases via `getRendererServerUrl()` and
  `getServerNetworkUrl()`;
- explicit protocol/hostname/port identity rather than `URL.origin`;
- rebasing of a stale network Server URL onto the renderer base.

`apps/web/src/lib/server-readiness.ts` correctly treats Desktop ready status as the
readiness fact, applies the projection, updates the generated client base, and closes the
snapshot/subscribe race. Browser-hosted mode alone polls `/health`.

However, the producer side is absent:

- `apps/desktop/src/shared/server-runtime.ts` has a ready state containing only
  `{ state: 'ready', serverUrl, bootstrap }`; it has no `connection` field.
- `apps/desktop/src/main/main-app.ts` calls `startServer(): Promise<string>`, initializes
  consumers from that string, and publishes no `owned-proxy`/`attached-http` projection.
- `apps/desktop/src/main/server-process.ts` can distinguish a reused locator internally,
  but does not return a `DesktopServerConnection`, generation, renderer transport, or
  authentication mode.
- There is no `apps/desktop/src/main/desktop-server-transport/` directory, no
  `registerSchemesAsPrivileged`, and no `session.defaultSession.protocol.handle` call.
- Therefore `connection` is absent at runtime and Web intentionally falls back to the
  HTTP `serverUrl`.

The Web projection type is also weaker than the plan’s required connection model:

- `DesktopServerConnectionProjection` in `base-url.ts` and the duplicate declaration in
  `apps/web/src/env.d.ts` omit `rendererTransport` and `authentication`.
- `generation` and `mainProxyTarget` are optional; attached direct HTTP and attached
  Main proxy are not discriminated.
- `rendererBaseUrl` is effectively any string, so the type cannot exclude an auth-required
  direct renderer with no verified browser session.
- The connection contract is duplicated in Web instead of imported from the Desktop/shared
  owner. At minimum, the shared contract and Web ambient declaration must stay mechanically
  identical; the cleaner end state is one importable owner type where build boundaries permit.

### Generated client and `cradleFetch`

`apps/web/src/lib/client.config.ts` correctly installs `cradleFetch` as the generated
client’s fetch hook and suppresses generated-client auth in custom-scheme mode. Generated
files need no manual edits.

`apps/web/src/lib/server-credential.ts` already does three important things:

- classifies both the renderer base and the network base as the same logical Server;
- rebases stale absolute HTTP Server requests to the runtime renderer base;
- rebuilds a `Request` in proxy mode so removed credential headers are not retained on the
  original Request object.

Remaining correctness work:

- Strip `x-cradle-token`, `x-cradle-relay-token`, and any newly named Cradle credential
  headers in addition to the three standard credential headers. Share a reviewed header
  list or contract so Web and Main cannot drift.
- Add parity tests for `Request` input with method/body/signal, `FormData`, streamed body
  where Chromium supports it, `URLSearchParams`, binary body, HEAD, and init headers
  overriding Request headers. Existing tests cover only a JSON Request and simple GET.
- Prove an external/data URL is not rebased and never receives Server credentials.
- Decide and test redirect handling at the Main proxy. Renderer rebasing must not turn an
  upstream cross-origin redirect into credentialed arbitrary-origin proxying.
- Remove Desktop-owned token reading, but retain a deliberately named browser/attached
  authentication seam only if product still supports a verified browser-owned session.
  `setBrowserServerToken()` currently has no production caller, so it is not evidence that
  authenticated direct-attached mode works after renderer token removal.

### Fetch-backed SSE

All production `new EventSource` matches are already gone. Current SSE users call
`openServerEventSource()` directly or through Chat/sync adapters, including:

- code activity;
- Download Center;
- workspace file events;
- plugin development session events;
- workflow runtime;
- session/global Chat event tails when neither Desktop broker nor `/sync` is selected.

The implementation in `apps/web/src/lib/server-transport/fetch-event-source.ts` has these
exact gaps:

| Required behavior | Current behavior / gap |
| --- | --- |
| Preserve listener identity | Function listeners work by reference, but each call to `normalizeListener(objectListener)` creates a new closure. `removeEventListener` cannot remove an `EventListenerObject`. Store the normalized wrapper in a per-object/per-type identity map. |
| Empty `id:` reset | `if (event.id)` ignores `''`, leaving the prior Last-Event-ID. Check presence/definedness, set null/empty consistently, and omit the reconnect header/query after reset. |
| Reconnect backoff | `attempt = 0` is set immediately after successful headers. A server that repeatedly opens then ends causes constant base-delay reconnects. Reset only after a meaningful accepted event (or another explicitly documented stability criterion), not header open. |
| Reader cleanup | The reader is local, never cancelled explicitly, and never `releaseLock()`ed. Close during a custom/non-fetch stream, close after headers, natural end, read error, reconnect, and late response resolution can retain a reader/body. Keep the active reader/response generation, cancel exactly once, and release it in `finally` before any reconnect. |
| External signal already aborted | Adding an abort listener to an already-aborted signal does not invoke it. Check `signal.aborted` synchronously before connecting. |
| Message metadata | `MessageEvent` carries data/type only; it does not expose `lastEventId` (and origin if consumers rely on it). Add conformance coverage and populate the standards-relevant fields. |
| Split UTF-8/final decoder flush | Streaming decode exists, but the decoder is not flushed on EOF. Test a multibyte code point split across chunks and EOF behavior, and flush before parser reset. |
| Late response after close | If `fetchImpl` resolves after `close()`, the code returns without cancelling the newly returned body. Cancel it before returning. |
| Request/reconnect ownership | `buildRequest` and `shouldReconnect` exist, but no tests prove attempt/last-event propagation, custom cursor query construction, retry field handling, malformed feature payload ownership, or no reconnect after disposal races. |

The existing test file has only two cases: basic CRLF/named/multiline parsing and “close
does not reconnect.” The latter uses a custom `ReadableStream` that ignores the supplied
AbortSignal and asserts only fetch call count; despite its name, it does not assert fetch
abort, body `cancel`, or reader release.

Required focused SSE matrix:

- LF and CRLF, comments/heartbeats, blank data, multiline data, named/default events;
- `id`, empty-id reset, `retry`, and `MessageEvent.lastEventId`;
- UTF-8 code point split at every byte boundary plus decoder flush;
- Request input preservation and feature-provided cursor/Last-Event-ID construction;
- abort before fetch, before headers, after headers, mid-frame, between frames, during
  reconnect delay, and after terminal close;
- natural EOF, HTTP error, missing body, reader error, malformed feature JSON (feature
  owner handles it), and reconnect policy returning false/true/numeric delay;
- escalating delay across header-open/immediate-close loops and reset only on the chosen
  stability fact;
- object listener add/remove identity;
- reader `cancel`/`releaseLock` exactly once per generation and no reconnect after disposal.

Use fake timers and instrumented streams/readers. Do not make component tests the primary
proof for this transport contract.

## Server-bound Web consumer matrix

The completion rule is: generated operations use the configured generated client;
hand-written Server HTTP uses `cradleFetch`; native subresources in custom-scheme mode use
the `cradle-server://local` URL directly; only explicit browser/attached HTTP fallback may
mint a resource ticket.

| Path | Current file(s) | Current state | Required completion proof |
| --- | --- | --- | --- |
| Generated JSON APIs | `lib/client.config.ts` and `api-gen/**` | Generated client is hooked to `cradleFetch`; good scaffold. | Request/status/error/cancellation parity through custom scheme; do not edit generated output manually. |
| Chat response/session SSE | `features/chat/commands/chat-response-command.ts` | Module-level stale base plus global fetch. Desktop broker covers normal response/session but not every command. | Resolve base per request and call `cradleFetch`; specifically exercise quick-question and side-conversation in Desktop. Preserve Plan 061/071 semantics. |
| Generic SSE | `lib/server-transport/fetch-event-source.ts` plus consumers listed above | Uses `cradleFetch`; parser/cleanup incomplete. | Full conformance matrix above and actual custom-scheme URL assertion. |
| Asset multipart upload | `features/assets/assets-api.ts` | Global fetch; `FormData` body. | Use `cradleFetch`; assert multipart content type/boundary/body and no buffering/re-serialization. |
| Protected chat blobs | `features/assets/use-protected-blob-url.ts` | Uses `cradleFetch`, then Blob/object URL; good seam. | Binary parity, abort/lease cleanup, object URL revocation. |
| Direct asset images/links | `features/assets/asset-url.ts`, `asset-markdown.tsx` | Builds `getServerUrl()` URL used by `<img>`/links. | In owned mode assert exact `cradle-server://local/assets/.../content`; packaged image load is mandatory. In direct attached auth mode use the named resource-ticket adapter if headerless loading requires it. |
| Workspace raw/PDF | `features/workspace/use-workspace-file-content.ts`, `workspace-pdf-preview.tsx` | URL is runtime base, but PDF component uses global fetch and buffers into `arrayBuffer` for PDF.js. | Use `cradleFetch`; representative real PDF render through custom scheme. PDF.js itself requires bytes, but Main proxy must stream rather than prebuffer. Abort/destroy on URL change. |
| Session ZIP/binary download | `features/session/download-session-zip.ts` | Uses `cradleFetch`; buffers a Blob for browser download. | Header/status/binary parity and object URL cleanup. Main proxy remains streamed even if final browser consumer creates a Blob. |
| Plugin descriptors/routes | `lib/plugin-host.ts` | Descriptors use generated SDK and route client uses `cradleFetch`; dev SSE uses fetch adapter. | Assert route URL remains custom scheme in owned mode and descriptor/dev watcher cleanup. |
| Plugin `web.mjs` import | `lib/plugin-host.ts`, `lib/authenticated-server-url.ts`, Server `plugins/static-server.ts` | Always mints resource ticket today. Server rewrites shared dependency imports relative to `request.url`. | Custom mode returns the direct custom URL with original query and zero ticket POSTs. Packaged dynamic import must also resolve rewritten `/api/plugins/-/deps/*.mjs` over the custom scheme under real CSP. HTTP(S) fallback ticket remains exact-path/single-use. |
| Plugin icons/mention icons | `features/plugins/{installed-tab,marketplace-tab,installed-plugin-row-view}.tsx`, `features/chat/mentions/plugin-mentions.ts` | Relative icon URLs are based on runtime Server URL and fed to `<img>`. | Packaged custom-scheme image proof; external absolute icons remain external and receive no credentials. Add owned/direct-attached URL selection tests. |
| Chronicle/search/devtool raw JSON | `features/chronicle/use-chronicle.ts`, `features/search/use-chronicle-search.ts`, `features/devtool/plugins/use-plugin-data.ts` | Global fetch against `getServerUrl()`. | Migrate to generated SDK if already available, otherwise `cradleFetch`; add these to the ratchet’s initial classified set. |
| Settings endpoint health probe | `features/settings/server-endpoint-settings.tsx` | Intentional global fetch to a user-entered candidate HTTP(S) URL. | Named allowlist entry: settings validation is not owned Server runtime traffic and must remain HTTP(S)-only. Never rebase it to custom scheme. |
| External changelog/tips/data URL | changelog modules and `chat-share-export.tsx` | Intentional non-Server global fetch. | Named allowlist entries with destination reason; assert no Server credentials. |

Raw `<img>` and dynamic `import()` cannot call `cradleFetch`, so runtime URL selection and
the Electron handler are their authentication boundary. This is why direct custom-scheme
URLs, exact session registration, and packaged CSP/module/image proofs are non-optional.

## Ticket and security invariants

### What is already present

Server ownership is concentrated in:

- `apps/server/src/http/auth.ts`;
- `apps/server/src/http/single-use-ticket.ts`;
- `apps/server/src/modules/pty/index.ts`;
- `apps/server/src/modules/sync-gateway/index.ts`;
- `apps/web/src/lib/authenticated-server-url.ts`;
- `apps/web/src/features/tui/pty-channel.ts`;
- `apps/web/src/lib/sync-socket/client.ts`.

The current ticket store hashes 32-byte random tickets, retains an audience and expiry,
uses a 30-second TTL, caps the store at 1,024 records, deletes on consumption (including
invalid attempted consumption of an existing digest), and supports prevalidation without
consumption. The global auth hook prevalidates WebSocket upgrade tickets; the matched PTY
or `/sync` route consumes them. A WeakMap makes the double `beforeHandle` invocation for
one Elysia upgrade Request idempotent without allowing a second Request to reuse the ticket.
PTY derives its audience from the exact request pathname; `/sync` pins audience to
`/sync`. Web reconnect paths call `getAuthenticatedServerWebSocketUrl()` from inside each
connection attempt, so the production structure can issue a fresh ticket per reconnect.

Resource tickets are issued for `resource:${pathname}`, accepted only on GET, and consumed
once by the global auth hook. Query and fragment are deliberately not part of the resource
audience; the issuance schema accepts only an absolute pathname without `?`/`#`.

### Invariants the implementation and tests must enforce

1. Renderer never receives the long-lived Desktop-owned bearer through argv, preload,
   ambient types, headers visible before the Main boundary, logs, errors, or diagnostics.
2. Main strips `authorization`, `cookie`, `proxy-authorization`, `x-cradle-token`,
   `x-cradle-relay-token`, and every owned credential header before injecting its current
   bearer. A renderer-supplied bearer must never win.
3. One WebSocket connect or reconnect performs one authenticated ticket POST through
   `cradleFetch`, then uses only the returned ticket on the network `ws:`/`wss:` URL.
4. A ticket is valid for exactly one pathname audience, expires at 30 seconds, and is
   consumed once. A `/sync` ticket cannot open either PTY route; a ticket for one encoded
   PTY path cannot open another path.
5. Prevalidation may not consume; matched route validation must consume. Idempotence is
   limited to the same upgrade `Request` object.
6. Custom-scheme resource/module/image/PDF requests mint no resource ticket. HTTP(S)
   resource tickets exist only in a named browser/attached fallback and remain exact-path,
   GET-only, short-lived, single-use.
7. Ticket-bearing URLs are never forwarded upstream by remote-host WebSocket bridging and
   never logged. `ticket`, `eventTicket`, and `resourceTicket` must be redacted from any
   new Desktop transport diagnostic URL. Prefer logging pathname only; do not rely solely
   on the generic observability regex, which is not query-parameter-specific.
8. The handler is installed only on `session.defaultSession`; BrowserPanel partitions from
   `apps/desktop/src/shared/browser-session.ts` must fail to resolve the scheme.

### Missing ticket tests / risks

- `apps/server/src/http/auth.test.ts` tests single use and wrong audience, but not expiry,
  wrong resource path, non-GET resource use, arbitrary query preservation, store cap, or
  ticket redaction.
- PTY and sync unit tests mock the authenticated URL helper. They do not prove the real
  ticket POST, exact route audience, consumption, or fresh issuance on reconnect.
- `apps/web/src/lib/authenticated-server-url.test.ts` covers HTTP ticket construction only;
  it has no custom-scheme no-mint case.
- The ticket issuance endpoint accepts any nonempty audience string. This still yields an
  exact-audience ticket, but tests should prove a renderer cannot turn it into bearer or
  cross-audience access. If security review expects an allowlist of ticketable WS routes,
  that is an explicit policy decision; do not silently add heuristic path matching.
- `eventTicket` consumption remains in global auth, but no issuance endpoint was found in
  the inspected production tree. It is legacy/dead-looking surface, not required by the
  current fetch-backed SSE path. Confirm ownership before deleting or expanding it.

## Renderer bearer removal blast radius

Current exposure is explicit and complete enough to ratchet:

- `apps/desktop/src/main/main-app.ts` adds `--server-auth-token` to the main window;
- `apps/desktop/src/main/window-manager.ts` adds it to Tearoffs and DevTools;
- `apps/desktop/src/preload/index.ts` parses and exposes `env.serverAuthToken`;
- `apps/web/src/env.d.ts` declares it;
- `apps/web/src/lib/server-credential.ts` reads it;
- `apps/web/src/lib/client.config.ts` derives generated-client auth from it.

Remove all of those owned-mode surfaces only after the custom handler and ticket issuance
path work. The child process still legitimately receives `CRADLE_AUTH_TOKEN` from Main,
and Main’s transport still owns the token; the ratchet must distinguish credential
ownership from renderer exposure. Do not delete the Server bearer itself.

Also update tests that currently construct `window.cradle.env.serverAuthToken`, especially
`server-credential.test.ts`, to prove absence rather than preserve the old shape. Keep the
browser/attached mode decision explicit: an auth-required direct-attached endpoint after
removal is representable only with a verified browser-owned session. If no such verification
exists, fail closed instead of reviving a renderer bearer.

## Static transport-boundary ratchet design

No transport checker exists. `apps/server/scripts/check-module-boundaries.ts` checks only
Server module import cycles/forbidden edges and should not be overloaded with Desktop/Web
network policy. Add a Desktop-transport-owned checker (for example
`apps/desktop/scripts/check-server-transport-boundaries.ts`) and wire it to a named Desktop
script plus `@cradle/desktop typecheck`; root typecheck/CI will then execute it. Keep Server’s
existing `check:boundaries` unchanged for its current responsibility.

Use the TypeScript AST plus a small explicit manifest, not an unreviewed grep heuristic.
The checker should scan production `.ts/.tsx` under `apps/desktop/src/main`,
`apps/desktop/src/preload`, and `apps/web/src`, excluding tests, stories, fixtures,
generated `api-gen`, static data, and the checker’s own test fixtures.

Required rules:

- Reject `serverAuthToken`, `--server-auth-token`, and equivalent credential arguments in
  Desktop window/preload/Web production files. Allow Server child credential ownership
  only in named Main transport/process files.
- Reject global/ambient `fetch` in Desktop Main unless the file/call is in the reviewed
  non-Server manifest (`browser-manager.ts` local browser target probe is the known case).
  Server-bound Main traffic must call the injected `DesktopServerTransport.fetch`.
- Reject global/ambient Web `fetch` unless classified as (a) the implementation inside
  `cradleFetch`, (b) a reviewed external/data URL, or (c) HTTP(S)-only endpoint-settings
  validation. All Server-bound hand-written requests use `cradleFetch`.
- Reject production native `EventSource` except a specifically named direct-attached
  adapter, if such an adapter is actually required. There is currently no production match,
  so the initial rule can be zero by default.
- Allow native `WebSocket` only in `features/tui/pty-channel.ts` and
  `lib/sync-socket/client.ts`, and require their URL source to be the authenticated ticket
  helper. Reject custom-scheme WebSocket construction.
- Restrict `getServerNetworkUrl()`/`getServerWebSocketUrl()` imports to the authenticated
  WebSocket construction and explicit local-mode/transport selection modules. Resource,
  image, module, PDF, SSE, and JSON modules must use the renderer base.
- Restrict `postAuthResourceTicket` to the named resource fallback helper and test that the
  helper branches away in custom mode. Restrict `postAuthWebsocketTicket` to the named WS
  helper.
- Reject strings/types/symbols for `owned-ipc`, process Request/Response framing,
  pull-credit HTTP bodies, a Server `desktop-transport` IPC host, and per-route Desktop IPC
  HTTP methods. Do not reject existing bootstrap/control IPC or native window/chat broker
  IPC by broad substring.

Manifest entries should be exact `{ file, construct, destinationClass, reason }` records.
The checker must fail if an entry no longer matches (stale allowlist) as well as when an
unclassified call appears. Unit-test the checker with tiny pass/fail fixtures for aliased
imports, `globalThis.fetch`, bare fetch, `new globalThis.EventSource`, renamed URL helpers,
credential strings, and allowed external/data/WS cases. A regex-only check will miss import
aliases and produce pressure to add broad directory exemptions.

Initial reviewed Web raw-fetch allowlist after migration should be very small:

- changelog and feature-tip CDN requests (external);
- `chat-share-export.tsx` data URL conversion;
- `server-endpoint-settings.tsx` user-entered HTTP(S) health probe;
- the underlying native fetch calls inside `server-credential.ts`.

Everything else in the current raw-fetch inventory is either a false match on `.refetch()`
or a Server call that should migrate.

## Packaged M0 and many-Tearoff smoke design

### Existing seams

- There is no committed custom-protocol M0 fixture.
- `e2e/src/support/electron-app.ts` launches the built development bundle, not a packaged
  artifact, and is not currently integrated into the normal Cucumber world.
- `.github/scripts/windows-packaged-e2e.mjs` already launches `win-unpacked/Cradle.exe`,
  connects over CDP, captures renderer/network errors, and is run by
  `.github/workflows/verify-windows-desktop-package.yml`. It is the strongest existing
  packaged-launch seam, but currently checks only basic app readiness and even reads the
  HTTP `env.serverUrl` directly.
- Normal PR/daily Cucumber workflows launch headless Chromium against Web/Server, not the
  Desktop custom protocol. They cannot prove Plan 063.
- Linux CI builds Desktop but has no Xvfb packaged launch. Windows has a packaged launch;
  macOS release packaging does not run this transport smoke.

### M0 gate

Implement a dedicated fixture before production routing. It should use the real privileged
scheme registration and default-session handler shape with a fake local upstream. Run the
same assertion bundle against electron-vite development and the unpacked package:

- GET/POST/non-2xx/status/header/HEAD/empty response parity;
- first byte before stream completion and renderer abort reaching stream cancellation;
- streamed upload when supported;
- 64 MiB response with sampled main + renderer RSS and a platform-specific bound defined
  in chunks, not “less than 64 MiB” handwaving;
- multipart byte/content-type preservation;
- `<img>` load, representative PDF read/render, and dynamic module import using the real
  plugin shared-dependency rewrite/CSP shape;
- default-session success and BrowserPanel partition failure.

Record exact artifact path, launch command, Electron/platform version, RSS baseline/peak,
chunk size, and cancellation counters as machine-readable JSON. A bundle build or screenshot
is not acceptance evidence. Linux needs Xvfb; extend the Windows packaged workflow; add
macOS when a runner can launch the artifact without product-only branches.

### M7 20-Tearoff transport smoke

Build one Node/Playwright Electron smoke separate from generic Cucumber UI journeys. Reuse
the cross-platform packaged launcher structure from `windows-packaged-e2e.mjs`, but keep a
single scenario implementation and platform-specific executable discovery wrappers.

Recommended deterministic sequence:

1. Launch a clean packaged app with `CRADLE_E2E=1`, wait for ready status, and assert
   `connection.kind === 'owned-proxy'`, renderer base equals `cradle-server://local`, and
   network base is loopback HTTP(S).
2. Through renderer custom-scheme fetches, create at least 20 lightweight sessions with
   unique IDs/titles. Open 20 unique Chat Tearoffs using the existing `window.tearOffSurface`
   IPC. Do not reuse one surface ID because `WindowManager` deliberately deduplicates it.
3. Start more than six independent long-lived streams across distinct session/event paths.
   Assert from per-window request instrumentation that their URL scheme is `cradle-server:`;
   do not infer this merely from UI responsiveness. Include at least one Desktop chat broker
   upstream so Main injection is exercised without changing broker frame semantics.
4. Concurrently perform a generated JSON mutation, raw JSON read, multipart upload, binary
   range/full read, plugin descriptor/module import, image load, and representative PDF
   read. Open one shell PTY: start it by custom-scheme POST, issue a fresh ticket, then use
   native WebSocket and exchange a ping/input/output frame.
5. Cancel streams, close ten Tearoffs, and wait until active protocol/undici request counts
   return to the expected remaining baseline. Then trigger the existing owned-child restart
   test hook, assert generation increments exactly once, old requests fail once, mutations
   are not replayed, and feature-owned cursor/snapshot recovery resumes reads without
   changing Plan 054/071 semantics.
6. Close all windows/streams and assert active proxy requests/readers/timers are zero,
   cancellation totals match, and memory returns within the M0 platform allowance.

The socket assertion needs two independent sources:

- Main-owned diagnostics: generation, active requests by method/path class, bytes/chunks,
  cancellation reason/count, Main PID, Server PID/port, and all renderer OS PIDs from
  `webContents.getOSProcessId()`. Never include query secrets, headers, or bodies.
- OS socket ownership sampled throughout the stream plateau and restart: `ss`/proc on
  Linux, `Get-NetTCPConnection` on Windows, and `lsof`/Network framework tooling on macOS.
  Assert no renderer OS PID owns a TCP connection to the owned Server port. Main PID
  connections are expected in v1. Also record renderer requests by scheme so a missing
  socket sample cannot hide a brief HTTP fallback.

DevTools/CDP request entries alone do not satisfy the plan’s process/socket requirement.
Conversely, counting all Electron sockets is wrong because CDP, external content, and
native WebSocket exist. Classify by renderer PID plus exact owned Server destination, and
separately allow the one ticketed PTY WebSocket.

Expose test diagnostics only through a gated, read-only `CRADLE_E2E=1` interface or
structured artifact emitted by Main. The interface must already redact ticket query values
and credentials; the test should include canary secrets and fail if any artifact/log contains
them.

CI should gate at least Linux packaged + Xvfb and the existing Windows unpacked package.
The current Cucumber P0 job is useful regression coverage but is not this acceptance gate.

## Dependency edges and execution order

The Web/auth slice cannot be completed independently of Desktop lifecycle/protocol work.
The required dependency graph is:

1. **M0 packaged protocol proof** gates every production routing change.
2. **Desktop connection owner** (`owned-proxy` vs `attached-http`, renderer transport,
   authentication, generation) must land before Web can select the custom base.
3. **Undici transport + default-session handler** must stream/cancel and strip/inject auth
   before renderer bearer removal.
4. **Desktop ready status/preload/shared type projection** enables
   `applyDesktopServerReadyEndpoint()` and generated-client rebasing.
5. **Web consumer and SSE hardening** then routes JSON/SSE/multipart/binary/subresources;
   plugin/image/PDF packaged proof must pass before claiming M5.
6. **Ticket path proof** must show ticket issuance through the custom scheme before removing
   `serverAuthToken` from windows/preload/Web.
7. **Static ratchet** should land in the same slice as the migrations, seeded with exact
   reviewed exceptions, so no new bypass appears between M5 and M7.
8. **20-Tearoff smoke** depends on transport diagnostics, restart generation fencing, and
   all representative consumers; it is the final runtime proof.

Cross-plan boundary: Plan 063 may inject a new fetch into Chat brokers and preserve the
same frames, but must not change Chat admission, completion, queue, provider lifecycle,
cursor semantics, or snapshot-first recovery. Reads resume only through existing feature
policy; mutations are never automatically replayed.

## Risks and STOP conditions

Stop rather than improvise if any of the following is encountered:

- Packaged Electron 42.4.1 cannot provide first-byte streaming, end-to-end cancellation,
  bounded 64 MiB memory, multipart, real plugin module/CSP, image, or PDF behavior using
  supported custom-protocol APIs.
- Correct plugin imports require `bypassCSP`, handler installation on BrowserPanel
  partitions, service-worker/extension privileges, or another security-boundary expansion.
- Removing the renderer bearer would require weakening WebSocket ticket audience, expiry,
  or single-use semantics, or using bearer/ticket reuse in query strings.
- An auth-required locator-backed Server has neither Main-owned valid credentials nor a
  verified browser session. It is `attached-http` and must fail closed; do not label it
  owned or silently expose/fallback.
- Any proposed fix introduces `owned-ipc`, multiplexed process Request/Response framing,
  per-route HTTP IPC, a Server process HTTP host, or PTY-over-IPC.
- The work needs a database schema change or changes Plan 061/054/071 semantics.
- The socket recorder cannot distinguish renderer PID/destination from Main undici and
  ticketed native WebSocket traffic. Do not replace the invariant with “UI stayed fast.”
- A required gate fails twice after a reasonable correction or current transport facts
  materially drift from `d40f895e`/this handoff.

Additional worktree risk: an untracked
`apps/server/src/http/websocket-ticket.ts` was present throughout this exploration. It
duplicates the ticket-store shape superseded by tracked `single-use-ticket.ts` and is not
imported by the inspected production code. Treat it as pre-existing/user/parallel work;
do not adopt, delete, or count it as Plan 063 implementation without resolving ownership.

## Explicit uncertainties to resolve during implementation

- Whether Electron’s packaged dynamic import from `cradle-server://` needs `codeCache`.
  M0 decides; never enable it speculatively, and never enable `bypassCSP`.
- The numeric RSS threshold and platform allowance for 64 MiB streaming. Establish from
  M0 measurements before writing the CI assertion.
- The exact cross-platform OS socket recorder implementation, especially macOS runner
  permissions. The invariant and required fields are known; tool availability must be
  proven on each release runner.
- Whether authenticated `attached-http/direct-http` remains a supported product mode after
  renderer token removal. Current `setBrowserServerToken()` has no production caller and
  Desktop does not verify a browser session. Product/owner must choose verified session or
  fail closed.
- Whether the legacy `eventTicket` auth branch has an owner outside the searched tree. It
  is unnecessary for fetch-backed SSE and should not be expanded casually.
- Whether resource-ticket issuance should enforce an allowlist of ticketable paths/audiences
  beyond exact binding. Current scope guarantees exact binding but not an issuance allowlist;
  changing that is a security-policy decision.
- How the packaged smoke triggers a controlled owned-child restart without exposing a
  general renderer control surface. Prefer a strictly `CRADLE_E2E=1` test hook or Main-side
  harness, reviewed with diagnostics.
- Whether the real plugin suite contains a bundle that exercises all shared dependency
  rewrites and the packaged CSP. If not, add one representative fixture rather than claiming
  the minimal `export` module is equivalent.

## Verification notes

Read-only inventories were rerun at `9f5f731`:

- production `new EventSource` under Web: zero;
- production `new WebSocket` under Web: exactly PTY and `/sync`;
- no Desktop custom scheme registration/handler/transport directory;
- renderer bearer matches remain in main window, Tearoff/DevTools window, preload, Web
  ambient type, and credential helper;
- raw Server fetches and runtime URL consumers match the matrix above;
- drift from `d40f895e` in the plan’s production transport scope is empty; HEAD changes the
  plan documentation only.

The plan records the baseline focused Web transport suite as 7/7. A fresh focused run in
this exploration could not be completed: the first `pnpm exec vitest` attempted dependency
materialization because the workspace had no usable `node_modules/.bin/vitest`, initially
failed on `/root/.local`, and a retry was blocked/cancelled by the restricted network
environment. No test result is claimed from that attempt. Production files remained
unchanged, and `git diff --check` was empty before this handoff was added.

Implementation verification should include, in order:

```bash
pnpm --filter @cradle/server typecheck
pnpm --filter @cradle/server check:boundaries
pnpm --filter @cradle/desktop typecheck
pnpm --filter @cradle/web typecheck
pnpm exec vitest run apps/desktop/src/main/desktop-server-transport --maxWorkers=1
pnpm exec vitest run --config apps/web/vitest.transport.config.ts \
  apps/web/src/lib/server-transport \
  apps/web/src/lib/authenticated-server-url.test.ts \
  apps/web/src/lib/server-credential.test.ts
pnpm --filter @cradle/server test
pnpm --filter @cradle/web test
pnpm test
pnpm lint
pnpm build:desktop
pnpm --filter @cradle/desktop pack
git diff --check
```

Record the exact pre-existing full-suite failures before editing. The two Chat Runtime
failures named by the plan may be recorded as baseline only if reproduced before the
slice; no new failure may be relabelled pre-existing.

## Handoff quality checklist

- [x] Self-contained: states baseline, current behavior, target invariant, and execution
  dependencies without requiring the exploration conversation.
- [x] Exact scaffold gaps: identifies concrete functions/files and distinguishes existing
  useful seams from missing production routing.
- [x] Interfaces and affected paths: covers shared/Desktop status, Web base/fetch/SSE,
  ticket endpoints/consumers, plugin/image/PDF/binary/multipart, ratchet, and CI smoke.
- [x] Security invariants: bearer ownership, complete header stripping, exact session,
  ticket audience/expiry/single use, resource fallback, partition denial, and redaction.
- [x] Test/stress design: specifies conformance cases, packaged M0 evidence, 20 unique
  Tearoffs, >6 streams, representative traffic, restart, cleanup, memory, and socket proof.
- [x] Dependency edges: orders M0, Desktop connection/proxy, Web routing, auth removal,
  ratchet, and smoke; preserves Plan 061/054/071 ownership.
- [x] Risks/STOP conditions and explicit uncertainties are separated from implementation
  facts.
- [x] No production code changes, no generated-file edits, no ownership taken over the
  pre-existing untracked ticket file, and no claim of tests that did not run.
