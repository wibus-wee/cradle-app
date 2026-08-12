# Exploration A handoff: Plan 063 M0 packaged custom-scheme gate

**Task node:** Plan 063, M0 only
**Repository inspected:** `cradle-app` at `9f5f731a3aa19fce93c4e37ca002343811a4b5fd` on 2026-08-13
**Disposition:** implement the M0 fixture as an isolated Electron application and make it a hard CI gate. Do not route production traffic through `cradle-server://` until this gate passes.

## Executive conclusion

Electron 42.4.1 exposes the required supported APIs, and the existing Desktop build can carry a separate fixture bundle inside an ASAR-packaged unpacked application. The least-coupled feasibility proof is a fixture-only Electron entry, renderer, fake HTTP upstream, protocol proxy, runner, electron-vite config, and electron-builder config under `apps/desktop/src/main/desktop-server-transport/fixtures/m0/`. It must not import `main-app.ts`, start the Cradle Server, use the locator, or depend on product authentication/lifecycle code.

The fixture should use the same protocol shape proposed for production:

```text
default-session renderer
  -> cradle-server://local/*
  -> session.defaultSession.protocol.handle
  -> fixture-only undici Agent
  -> loopback node:http fake upstream
```

It should also create one BrowserPanel-shaped persistent partition and prove that the partition has no handler. Results must be JSON, assertions must be automated, and both the development and packaged runs must exit nonzero (or omit the required success marker) on any failure. Screenshots are not acceptance evidence.

## Verified current facts

| Fact | Repository evidence | Consequence for M0 |
| --- | --- | --- |
| Electron is pinned to `42.4.1`. | `apps/desktop/package.json` | Record `process.versions.electron === "42.4.1"` in every result and fail otherwise. |
| `Protocol.handle` accepts and returns standard Fetch `Request`/`Response`; `registerSchemesAsPrivileged` supports `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `stream`, `codeCache`, and `bypassCSP`. | Installed `apps/desktop/node_modules/electron/electron.d.ts` | Use only the five privileges locked by Plan 063. Keep `codeCache`, `bypassCSP`, service workers, and extension access false/omitted. |
| Privileged scheme registration must happen before `app.ready`. | Electron declarations and Plan 063 | The fixture main entry must call `protocol.registerSchemesAsPrivileged(...)` at module evaluation, before `app.whenReady()`. |
| The product main entry defers `main-app` through `void import('./main-app')`; the product currently creates its main window before Server startup. | `apps/desktop/src/main/index.ts`, `main-app.ts` | Do not boot the product entry for M0. A separate entry eliminates startup races and prevents an accidental production route. |
| Main and Tearoff windows use the default session; BrowserPanel views use `persist:cradle-browser-<owner>`. | `main-app.ts`, `window-manager.ts`, `browser-manager.ts`, `shared/browser-session.ts` | Default-session success plus a `persist:cradle-browser-m0` denial window is representative of the actual session boundary. |
| `electron-vite` 5 accepts `--config` and `--entry`; an alternate entry is launched from `ELECTRON_ENTRY`. | Installed electron-vite CLI/source | A fixture-specific config/entry can run without changing product bootstrap. |
| Product builder output is `apps/desktop/release`; `--dir` yields `linux-unpacked`, `win-unpacked`, or `mac[-ARCH]`. Product files are ASAR-packed. | `apps/desktop/electron-builder.mjs`, electron-builder 26.15.6 source | Give M0 its own `release/m0` directory, retain `asar: true`, and resolve the executable deterministically by platform. |
| `pnpm --filter @cradle/desktop pack` currently runs the full Desktop build then `electron-builder --dir`. | `apps/desktop/package.json` | Add the isolated M0 packaged smoke to the end of `pack`; a bundle-only `build:desktop` remains necessary but is not packaged-runtime evidence. |
| CI's Desktop build is Linux bundle-only. Windows has a real unpacked-package workflow and packaged app launch. Linux currently has no Xvfb step. | `.github/workflows/ci.yml`, `verify-windows-desktop-package.yml`, `.github/scripts/windows-packaged-e2e.mjs` | Add a Linux Xvfb M0 job and add the fixture smoke to the existing Windows package workflow. Do not claim the current Build job proves M0. |
| The current product renderer HTML has no explicit CSP. Runtime plugin bundles are served as JavaScript modules and their React imports are rewritten to same-request-origin dependency wrappers. | `apps/web/index.html`, `tearoff.html`, `apps/web/src/lib/plugin-host.ts`, `apps/server/src/plugins/static-server.ts`, `apps/server/src/plugins/loader.ts` | Test both a strict representative CSP that explicitly permits `cradle-server:` and one real built plugin bundle with custom-scheme dependency wrapper requests. Record that the current product CSP is absent; do not enable `bypassCSP`. |
| The real PDF consumer fetches and calls `response.arrayBuffer()` before handing bytes to PDF.js. | `apps/web/src/features/workspace/workspace-pdf-preview.tsx` | A representative PDF assertion must use `fetch` + `arrayBuffer`, check content type/signature/length, and may additionally parse with PDF.js. |
| Current worktree contains an unrelated untracked `apps/server/src/http/websocket-ticket.ts`. | `git status --short` during exploration | Preserve it; M0 must not edit or delete it. |

No `apps/desktop/AGENTS.md` exists. The root `AGENTS.md` applies. This exploration made no production-code change.

## Exact fixture boundary

Create only fixture/build support in the following boundary for M0 (names may be shortened only if responsibilities stay separate):

```text
apps/desktop/src/main/desktop-server-transport/fixtures/m0/
  electron.vite.config.ts        # alternate main/preload/renderer inputs; dist/m0 output
  electron-builder.mjs           # fixture-only ASAR app; release/m0 output
  main.ts                        # pre-ready registration, handler install, windows, result/exit
  preload.ts                     # narrow report/diagnostics IPC bridge only
  fake-upstream.ts               # loopback node:http routes and cancellation/backpressure probes
  proxy-handler.ts               # fixture-only custom URL -> undici request/Response conversion
  renderer/
    index.html                   # strict representative CSP and no inline script
    index.ts                     # ordered browser assertions and chunk-discard consumer
    partition.html               # attempts fetch and image from BrowserPanel-shaped partition
    one-page.pdf                 # deterministic valid representative PDF, if not generated in upstream
    pixel.png                    # deterministic image bytes, if not generated in upstream
  prepare-real-plugin.mjs        # builds/prepares real system-info web.mjs and dependency wrappers
  run-m0.mjs                     # timeout, launch, result validation, logs, process cleanup
  result-schema.ts               # one shared typed result/assertion schema
```

Generated fixture outputs belong in ignored paths, not source control:

```text
apps/desktop/dist/m0/
apps/desktop/release/m0/
apps/desktop/.m0-results/
```

Required package/build integration:

- Add `undici` as a direct `@cradle/desktop` dependency. The fixture must instantiate an `Agent`; it must not rely on Node's ambient global fetch or a transitive dependency.
- Add `es-module-lexer` as a Desktop dev dependency only if `prepare-real-plugin.mjs` cannot reuse a standalone existing build helper without importing Server runtime state. Do not import `createServerApp`, `main-app.ts`, or Server plugin activation.
- Add fixture entries to the fixture electron-vite config only. Do not add the fixture main as a product `rollupOptions.input`.
- The fixture electron-builder config uses `extraMetadata.main: "dist/m0/main/index.js"`, `files: ["dist/m0/**/*"]`, `asar: true`, `npmRebuild: false`, `directories.output: "release/m0"`, `productName: "Cradle M0 Gate"`, and `executableName: "cradle-m0-gate"`. It has no production `afterPack`, Server/CLI/database resources, updater, mac bridge, or product entitlements.
- Package prepared real-plugin assets under `resources/m0/`; development reads the same prepared bytes from `dist/m0/fixture-resources`. The dev and package cases must not serve different module source.
- `run-m0.mjs` owns result paths and timeouts. Test logic must not be embedded as YAML shell snippets.

Explicit non-boundaries:

- No changes to `apps/server/src/app.ts`, the Elysia listener, Desktop server process startup, Chat brokers, Web runtime base selection, or credentials in M0.
- No import of future production `DesktopServerTransport`; M0 is feasibility evidence, not an early implementation hidden in fixtures.
- No process-IPC HTTP framing, per-route RPC, PTY bridge, cookie bootstrap, or renderer HTTP fallback.

## Scheme and fake-upstream contract

Register exactly:

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
```

After readiness, install only `session.defaultSession.protocol.handle('cradle-server', handler)`. The handler accepts only protocol `cradle-server:`, hostname `local`, and an empty port. The fixture proxy converts path/query to the loopback fake-upstream URL, passes `request.signal`, streams `request.body` with undici `duplex: 'half'`, and returns a streaming `Response`. Do not use `URL.origin`, `net.fetch`, whole-body helpers, or a buffer-backed response.

The fake upstream should expose these exact behavioral routes:

| Route | Behavior | Machine assertion |
| --- | --- | --- |
| `/get?value=m0` | 200 JSON echo plus `x-m0-upstream: get`. | Query, method, status, header, and JSON survive. |
| `/post` | Read raw POST bytes and echo SHA-256/length. | Renderer-sent bytes match without text coercion. |
| `/status` | Return 418 with `x-m0-status: teapot` and a small body. | Non-2xx remains a resolved `Response`; status/header/body are unchanged. Record `statusText`, but do not fail solely on platform wording. |
| `/response-stream` | Write chunk 1, flush, wait 1,000 ms, then write final chunk. | Renderer receives chunk 1 at least 750 ms before completion. This fails if the response is whole-buffered. |
| `/cancel-stream` | Emit numbered chunks until socket close. Wrap the handler response stream so its `cancel()` forwards to the undici reader and increments a counter. | After renderer reads one chunk and aborts, handler request signal aborts, wrapper `cancel()` is called exactly once, upstream observes close exactly once, and bytes stop within 2 s. |
| `/request-stream` | Record timestamps and sizes for first/last upload chunks; echo them after EOF. | At least two nonempty chunks arrive with a >=250 ms separation retained from the renderer source. If Electron reports streamed upload unsupported, that is a gate failure for this plan, not an allowed skip. |
| `/multipart` | Capture raw bytes and content type; return field/file checks. | Header has a boundary; a UTF-8 field, filename, and binary sentinel all survive byte-for-byte. |
| `/binary?bytes=N` | Stream deterministic 256 KiB chunks, honoring Node backpressure, without allocating `N` bytes. | Exact byte count and rolling digest match for 64 MiB; a 128 MiB canary establishes non-linear RSS behavior. |
| `/pixel.png` | Return deterministic PNG with image content type. | `<img>` fires `load`, has nonzero natural dimensions, and the route hit counter is one. |
| `/one-page.pdf` | Return deterministic valid one-page PDF. | `fetch` + `arrayBuffer` sees `application/pdf`, `%PDF-`, expected digest/length; optional PDF.js parse reports one page. |
| `/api/plugins/system-info/web.mjs` | Return the real built `plugins/system-info/dist/web.mjs`, with shared imports rewritten to `cradle-server://local/api/plugins/-/deps/*.mjs` using the same mapping as Server. | Dynamic import resolves, exports `activate`, and a stub context observes registrations/logging without executing product network calls. |
| `/api/plugins/-/deps/*.mjs` | Return generated wrappers backed by `window[Symbol.for('cradle:modules')]`. | Every module/dependency request is counted as `cradle-server:`; no HTTP(S) resource ticket or fallback is used. |
| `/diagnostics` | Return only counters/timings/sizes; no bodies. | Used after abort and cleanup; active request count returns to zero. |

The plugin preparation step must build `@cradle/system-info`, rewrite only the known shared dependency specifiers, assert that no known bare shared specifier remains, generate wrappers from actual installed React module exports, and copy the resulting bytes into the fixture resources. A toy `export default 42` module is useful as a first diagnostic but is not sufficient acceptance evidence.

The renderer HTML should use an explicit representative policy such as:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; script-src 'self' cradle-server:; connect-src cradle-server:; img-src cradle-server: data:; style-src 'self' 'unsafe-inline'">
```

This is intentionally stricter than today's product HTML, which has no explicit CSP. The result must record both facts: strict representative CSP passed, and `bypassCSP` was false. If product CSP changes before M5, M5 must rerun the real renderer policy; M0 must not silently claim that a stale fixture is exact.

## Result and launch protocol

`run-m0.mjs` creates an absolute result path under `apps/desktop/.m0-results/<mode>-<platform>-<arch>.json`, removes any stale result before launch, passes it through `CRADLE_M0_RESULT_PATH`, and imposes a 120-second run timeout (180 seconds on Windows CI). The fixture writes to a temporary sibling and renames atomically only after every assertion and cleanup completes. It then exits 0. A missing file, malformed schema, any false assertion, wrong Electron version, timeout, signal, or nonzero exit fails the runner.

Minimum JSON fields:

```ts
interface M0Result {
  schemaVersion: 1
  passed: boolean
  mode: 'development' | 'packaged'
  electronVersion: '42.4.1'
  platform: NodeJS.Platform
  arch: string
  artifactPath: string | null
  schemePrivileges: {
    standard: true
    secure: true
    supportFetchAPI: true
    corsEnabled: true
    stream: true
    codeCache: false
    bypassCSP: false
    allowServiceWorkers: false
    allowExtensions: false
  }
  assertions: Record<string, { passed: boolean, details: Record<string, number | string | boolean> }>
  memory: {
    chunkBytes: 262144
    baselineKiB: { main: number, renderer: number }
    peak64MiBKiB: { main: number, renderer: number }
    peak128MiBKiB: { main: number, renderer: number }
    settledKiB: { main: number, renderer: number }
  }
  counters: {
    activeRequests: number
    responseCancels: number
    upstreamCloses: number
    defaultSessionHits: number
    partitionHits: number
  }
}
```

Capture stdout/stderr next to the JSON. Logs may contain route names, sizes, durations, process IDs, and cancellation reasons, but no request/response body bytes or future credentials/tickets.

## Streaming, cancellation, and RSS gates

### Response first byte

The renderer must call `response.body.getReader()` and record the first successful `read()` before the upstream's delayed final write. Pass only when final completion is at least 750 ms after first-byte delivery. Calling `response.arrayBuffer()`, `blob()`, or `text()` on this route invalidates the assertion.

### Renderer cancellation

Use an `AbortController`, read one chunk, call `abort('m0-renderer-cancel')`, then poll fixture diagnostics. Pass only when all four conditions hold:

1. the handler's incoming `Request.signal` becomes aborted;
2. the returned response stream's `cancel()` runs exactly once;
3. cancellation reaches `undici` and the fake upstream observes exactly one close;
4. active requests return to zero and no additional chunks are counted after a two-tick grace period.

A rejected renderer read alone is not enough; it does not prove upstream cancellation.

### Streamed upload

Use a renderer `ReadableStream<Uint8Array>` with at least three 256 KiB chunks and 250 ms between enqueues, with the runtime `duplex: 'half'` option. Pass only when the upstream observes multiple chunks and the first-to-last arrival interval remains at least 250 ms. A fallback that concatenates the chunks before `fetch` is forbidden.

### Binary/RSS

Sample every 25 ms during transfer. Main RSS is `process.memoryUsage().rss`; renderer working set is the matching PID from `app.getAppMetrics()` (`webContents.getOSProcessId()` identifies it). On Linux/Windows, `workingSetSize` is the RSS-equivalent Electron exposes. The renderer consumes and discards one chunk at a time while maintaining only byte count and a rolling digest.

Use these initial machine gates:

- 64 MiB transfer: exact bytes/digest; peak delta from the immediately preceding settled baseline is **<48 MiB for Main and <48 MiB for renderer**.
- 128 MiB canary with the same 256 KiB chunks: each process's peak delta is **no more than its 64 MiB peak delta +16 MiB**.
- After readers, agent, and fake-upstream request state close, active request count is zero. Record settled RSS after five seconds; settled RSS is diagnostic because allocator retention is platform-dependent, not a reason to skip peak bounds.

The 128 MiB canary is how the gate distinguishes fixed process overhead from body-size scaling. A platform allowance may be adjusted once, before production migration, only with the raw trace attached and while keeping every per-process bound below 64 MiB and the 64-to-128 MiB slope below 16 MiB. Linear growth, a >=64 MiB per-process delta, hidden buffering, or a second failed correction is a STOP condition.

macOS does not expose renderer RSS with the same semantics; record `app.getAppMetrics().memory.workingSetSize` plus Main private memory, but do not weaken the Linux/Windows numeric gate.

## Exact scripts and commands to add

Add these package-level scripts (the runner may combine internal steps, but keep these user-facing names stable):

```json
{
  "m0:custom-scheme:prepare": "pnpm --filter @cradle/system-info build && node src/main/desktop-server-transport/fixtures/m0/prepare-real-plugin.mjs",
  "m0:custom-scheme:build": "pnpm m0:custom-scheme:prepare && electron-vite build --config src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts",
  "m0:custom-scheme:dev": "node src/main/desktop-server-transport/fixtures/m0/run-m0.mjs --mode development",
  "m0:custom-scheme:pack": "pnpm m0:custom-scheme:build && electron-builder --config src/main/desktop-server-transport/fixtures/m0/electron-builder.mjs --dir --publish never",
  "m0:custom-scheme:packaged": "pnpm m0:custom-scheme:pack && node src/main/desktop-server-transport/fixtures/m0/run-m0.mjs --mode packaged",
  "m0:custom-scheme:gate": "pnpm m0:custom-scheme:dev && pnpm m0:custom-scheme:packaged"
}
```

`run-m0.mjs --mode development` must run the prepare step and spawn this underlying command from `apps/desktop`:

```bash
electron-vite dev \
  --config src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts \
  --entry dist/m0/main/index.js
```

The renderer URL comes from electron-vite; the fixture must not bind its own dev web server.

Primary local/CI commands from repository root:

```bash
# Development Electron proof (requires a display; prefix the command with xvfb-run -a on Linux CI)
pnpm --filter @cradle/desktop m0:custom-scheme:dev

# Build the fixture, create an ASAR-packed unpacked app, and launch that exact executable
pnpm --filter @cradle/desktop m0:custom-scheme:packaged

# Both modes; this is the M0 focused gate
pnpm --filter @cradle/desktop m0:custom-scheme:gate

# Required repository build evidence, separate from runtime proof
pnpm build:desktop

# Required product pack path. Amend Desktop's existing `pack` script so it runs the
# isolated packaged M0 verifier after its normal product `electron-builder --dir` step.
pnpm --filter @cradle/desktop pack

git diff --check
```

Expected fixture artifact executable paths:

| Platform | Path |
| --- | --- |
| Linux x64 | `apps/desktop/release/m0/linux-unpacked/cradle-m0-gate` |
| Windows x64 | `apps/desktop/release/m0/win-unpacked/cradle-m0-gate.exe` |
| macOS arm64 | `apps/desktop/release/m0/mac-arm64/Cradle M0 Gate.app/Contents/MacOS/cradle-m0-gate` |
| macOS x64 | `apps/desktop/release/m0/mac/Cradle M0 Gate.app/Contents/MacOS/cradle-m0-gate` |

The runner must resolve exactly one expected path; do not scan for an arbitrary Electron executable. Result JSON must contain the resolved absolute artifact path in packaged mode and `null` in development mode.

## Platform and CI strategy

| Platform/job | Proposed integration | Gate level | Required evidence |
| --- | --- | --- | --- |
| Linux x64 PR | Add `desktop-m0-custom-scheme` to `.github/workflows/ci.yml`, `runs-on: ubuntu-latest`. Use the normal setup action, install Xvfb plus Chromium/Electron shared libraries (`pnpm exec playwright install-deps chromium` is the maintained dependency installer), then run `xvfb-run -a pnpm --filter @cradle/desktop m0:custom-scheme:gate`. | Required before M1/production migration. | Both dev and `release/m0/linux-unpacked` JSON/log artifacts uploaded on failure; Electron 42.4.1 and RSS thresholds pass. |
| Windows x64 package | Add M0 build/launch steps to `.github/workflows/verify-windows-desktop-package.yml` after setup and before the current product package E2E. Add a `pull_request` path trigger covering the fixture, Desktop package/config, pnpm lockfile, and workflow; retain `workflow_dispatch` for the exact feature SHA. | Required packaged-platform result. | `pnpm --filter @cradle/desktop m0:custom-scheme:packaged`; upload `.m0-results` and `release/m0/builder-effective-config.yaml`. Record the dispatched run URL in Plan 063 Progress before M1. |
| Windows release | Add the same packaged fixture command to `release-desktop.yml`'s Windows job before publishing installers, so an Electron upgrade or packaging drift cannot bypass the feasibility gate later. | Release ratchet. | Same JSON schema/thresholds; no `continue-on-error`. |
| macOS arm64 release | First add a manual/non-blocking run on `macos-latest` using the same fixture code and direct `.app/Contents/MacOS/...` launch. Promote it to required only after one clean run without fixture-specific product privileges or broad entitlements. | Not an M0 Done blocker per the plan's minimum, but desired. | Module/image/cancellation/streaming results plus memory diagnostics; no special product code, `bypassCSP`, or session broadening. |

Do not put `continue-on-error` on M0 assertions. A Linux `--no-sandbox` launch may be used only if GitHub's runner kernel requires it and the result records it; the renderer's Electron `sandbox: true` preference must remain enabled. Local Work containers without a display are not M0 evidence.

Upload only compact result JSON and stdout/stderr by default. The 64/128 MiB response bodies are generated, streamed, and discarded; they must never become CI artifacts.

## Complete M0 assertion set

The result must have an individually named true assertion for each item:

- `scheme.privileges.exact`
- `scheme.defaultSession.handled`
- `scheme.browserPanelPartition.unhandled`
- `fetch.get.queryAndHeaders`
- `fetch.post.binaryBody`
- `fetch.non2xx.responseParity`
- `response.firstByteBeforeCompletion`
- `response.cancel.invokedOnce`
- `response.cancel.reachesUpstream`
- `request.streaming.multiChunk`
- `multipart.contentTypeAndBytes`
- `binary.64MiB.digestAndLength`
- `binary.64MiB.mainRssBound`
- `binary.64MiB.rendererRssBound`
- `binary.128MiB.nonLinearMainRss`
- `binary.128MiB.nonLinearRendererRss`
- `subresource.image.loads`
- `subresource.dynamicModule.simple`
- `subresource.dynamicModule.realPlugin`
- `subresource.dynamicModule.dependenciesStayCustomScheme`
- `subresource.pdf.arrayBufferReadable`
- `security.strictRepresentativeCsp`
- `security.noBypassCsp`
- `cleanup.activeRequestsZero`
- `cleanup.agentAndServerClosed`

The partition assertion requires both Main-side evidence (`session.fromPartition(...).protocol.isProtocolHandled('cradle-server') === false`) and renderer-side evidence (fetch rejects and image fires `error`). `partitionHits` must remain zero.

## Risks and explicit uncertainties

1. **Provisional RSS thresholds.** The `<48 MiB` peak and `+16 MiB` slope bounds are concrete starting gates, not observed results. M0 execution must publish raw samples and may calibrate once under the restrictions above. The current container cannot launch Electron and supplies no measurement.
2. **Renderer upload streaming.** Electron/Chromium may reject or buffer a `ReadableStream` upload despite `supportFetchAPI`. The prior disposable probe reportedly passed, but there is no committed evidence. Failure is a STOP, not a skip.
3. **`Response.statusText` wording.** Chromium may normalize reason phrases. M0 should record it; M1 owns exact HTTP parity. Status, headers, and body are mandatory now.
4. **Repeated response headers.** M0 does not need to solve `set-cookie` multiplicity; M1 owns repeated-header characterization. Do not infer parity from this gate.
5. **Current product CSP is absent.** The strict fixture is stronger for scheme feasibility but not proof of a future product policy. M5 must retest the actual built renderer and real plugin loading after its transport changes.
6. **Actual plugin preparation duplicates the Server's shared-import mapping.** The preparation script must fail on an unknown shared specifier instead of silently leaving it bare. If reuse would require importing Server runtime state, keep the small fixture-only copier and compare its mapping in a test.
7. **macOS memory semantics.** Electron documents private memory as more meaningful than resident set on macOS. Keep macOS diagnostic until a stable platform threshold is established; Linux and Windows remain the numeric M0 gate.
8. **Packaging isolation versus product packaging.** The fixture package deliberately excludes product startup and resources. Requiring `pnpm --filter @cradle/desktop pack` to invoke the isolated packaged verifier ensures the documented product command cannot pass without M0, while avoiding a test-mode branch in production bootstrap.
9. **CI cost.** Building all Desktop Server/CLI resources is unnecessary for the fixture. Build only `@cradle/system-info` plus fixture bundles in the dedicated jobs; retain the separate normal Desktop Build job.
10. **Artifact path drift.** electron-builder omits the x64 suffix but adds `-arm64`. The runner must encode this behavior and fail if builder output moves unexpectedly.

## STOP conditions

Stop M0 and report the result/log/measurement; do not begin production routing or improvise if any of these occurs:

- Development passes but the ASAR-packaged unpacked app cannot reproduce streaming, cancellation, FormData, image, PDF/binary, real plugin module, or partition isolation using supported Electron 42.4.1 APIs.
- Response or upload bodies are buffered proportional to total size, a per-process 64 MiB transfer delta reaches 64 MiB, or the 128 MiB canary grows linearly after one evidence-based correction.
- Renderer abort does not invoke the returned stream's cancellation and close the fake upstream exactly once.
- The real plugin module requires `bypassCSP`, `codeCache`, service-worker privilege, extension privilege, a handler on `persist:cradle-browser-*`, or a renderer HTTP(S) fallback.
- Custom-scheme requests can reach a host other than exact `local`, include a port/credentials, or resolve in the BrowserPanel partition.
- Making the fixture pass appears to require a multiplexed process Request/Response protocol, pull-credit framing, a Server IPC host, PTY-over-IPC, per-route RPC, or whole-body base64/buffering.
- The work would need product Chat admission/completion/cursor/snapshot changes, a database schema change, or weakening the existing audience/single-use ticket model.
- A verification gate fails twice after a reasonable correction, Electron/package versions drift materially from those recorded, or Windows/Linux CI cannot launch the same fixture without broad product/security changes.

On STOP, leave production routing untouched and open the separate Plan B decision for local HTTP/2 over TLS. Do not restore owned renderer HTTP/1.1 fallback.

## Dependency edges to later Plan 063 nodes

| M0 output | Consumer / edge |
| --- | --- |
| **M0 pass is a hard predecessor.** | M1-M7 must not start production migration before the packaged result is recorded. Characterization-only preparation may be drafted, but no production transport route may land. |
| Fake-upstream routes and body digests. | M1 should promote them into reusable HTTP parity fixtures and add redirects, empty bodies, repeated headers, range, auth tickets, abort-before-headers, and slow-consumer cases. |
| Proven undici Request/Response/abort pattern. | M2 may implement the real `DesktopServerTransport.fetch`; it must not import fixture code. Copy behavior into production behind tests, then delete any accidental dependency edge from production to `fixtures/`. |
| Exact pre-ready privilege set and authority/session evidence. | M3 uses the same registration values and installs the production handler only on `session.defaultSession`. `codeCache` remains false unless the real-plugin assertion proves it is necessary (expected: it is not). |
| Main/renderer streaming and cancellation traces. | M2 generation fencing and M3 protocol integration must preserve these observations through the real transport. |
| Image, PDF, multipart, binary, and real plugin module cases. | M5 reruns them against the actual Web URL/resource consumers after `rendererBaseUrl` becomes `cradle-server://local`. The real plugin/CSP case is specifically an M5 regression gate. |
| BrowserPanel partition denial. | M3 and M6 security tests reuse it; production must never install a handler on `persist:cradle-browser-*`. |
| RSS threshold and sampler. | M7 reuses the numeric platform allowance in the 20-Tearoff packaged stress smoke. M7 adds process/socket ownership and verifies zero renderer HTTP(S) connections; M0 alone does not prove the pool invariant. |
| Fixture runner, platform artifact resolver, CI jobs. | M7 should extend/reuse the orchestration for the many-Tearoff packaged smoke rather than creating a second unbounded Electron launcher. |
| Current CSP absence noted explicitly. | Any CSP introduction before M5 is transport drift and requires rerunning the actual renderer module/image cases; M0's representative policy is not a waiver. |

## Suggested implementation order inside M0

1. Add the typed result schema, fake upstream, fixture proxy, and renderer assertions.
2. Add the alternate electron-vite config and make the development run pass under a real display.
3. Add actual plugin preparation and strict-CSP module assertions; confirm no `bypassCSP`/`codeCache` need.
4. Add the fixture builder config, platform artifact resolver, atomic result runner, and packaged smoke.
5. Run Linux dev and packaged modes, establish/record numeric RSS evidence, and correct at most once.
6. Add Linux CI/Xvfb and Windows package-workflow integration; run the Windows workflow at the feature SHA.
7. Run `pnpm build:desktop`, the amended `pnpm --filter @cradle/desktop pack`, and `git diff --check`.
8. Record exact commands, artifact paths, RSS values, platforms, and CI run URLs in Plan 063 Progress before authorizing M1.

## Handoff quality checklist (verified)

- [x] Read the complete root `AGENTS.md` and Plan 063; confirmed no Desktop-local AGENTS file exists.
- [x] Inspected Desktop package scripts, electron-vite inputs/outputs, electron-builder configuration, app/main/window/session bootstrap, BrowserPanel partition ownership, plugin module loading, PDF consumer, CI Build, release platform jobs, Windows packaged verification, and current Electron/electron-vite/electron-builder declarations.
- [x] Distinguished verified repository facts from proposed fixture design and from unmeasured uncertainties.
- [x] Specified exact fixture ownership, generated-output boundaries, fake-upstream routes, result schema, launch/build commands, artifact paths, CI runners, and numeric resource gates.
- [x] Included automated streaming, upload, cancellation, RSS, FormData, binary, image, PDF, real plugin module/CSP, default-session, and partition-denial assertions.
- [x] Included locked-architecture exclusions, security constraints, explicit STOP conditions, and Plan B handoff behavior.
- [x] Mapped evidence and code/test infrastructure dependencies to M1-M7 without moving later milestone semantics into M0.
- [x] Preserved the unrelated dirty-worktree file and made no production-code change.
- [x] Identified that local bundle/build success is not packaged runtime evidence and that the current container lacks a display.
- [x] Formal output is this handoff file only.
