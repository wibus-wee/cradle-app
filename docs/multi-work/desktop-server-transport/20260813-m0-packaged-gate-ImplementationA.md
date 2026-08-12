# Implementation A handoff: Plan 063 Node A packaged custom-scheme feasibility gate

**Task node:** Plan 063 Node A / M0 only
**Implementation date:** 2026-08-13
**Disposition:** the isolated fixture, build/package scripts, result contract, focused tests, and Linux/Windows CI ratchets are implemented. Production routing remains unchanged. Local static and bundle validation passes; local development/packaged Electron runtime evidence is not available from this Work container and must come from the added Xvfb Linux job and Windows packaged workflow before Node C or any production migration begins.

## Outcome

Node A now has a fixture-only Electron application under `apps/desktop/src/main/desktop-server-transport/fixtures/m0/`. Its only request path is:

```text
default-session fixture renderer
  -> cradle-server://local/*
  -> session.defaultSession.protocol.handle
  -> fixture-owned undici Agent
  -> loopback node:http fake upstream
```

The fixture does not import product `main-app.ts`, `server-process.ts`, a Server app/runtime, the locator, credentials, Chat, Web runtime selection, or a future production `DesktopServerTransport`. Static inspection of both source and the built Main bundle found none of those imports. The only non-fixture application edits are Desktop package scripts/dependencies, ignored-output declarations, and CI workflow integration.

`protocol.registerSchemesAsPrivileged` runs at fixture module evaluation with exactly `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, and `stream`. The handler is installed only on `session.defaultSession`. The fixture creates `persist:cradle-browser-m0` separately and requires Main-side unhandled state plus renderer fetch rejection, image error, and zero partition hits. `codeCache`, `bypassCSP`, service-worker access, and extension access remain false; renderer windows retain `sandbox: true`, context isolation, no Node integration, and web security.

## Implemented files and responsibilities

The fixture boundary contains:

- `result-contract.mjs`, `result-contract.d.mts`, and `result-schema.ts`: the shared runtime validator, exact 25-name assertion list, Electron pin, privilege record, TypeScript result schema, counters, and raw 25 ms memory traces.
- `fake-upstream.ts`: isolated loopback GET, binary POST, non-2xx, delayed response, cancellable response, streamed upload, multipart, deterministic 64/128 MiB binary, PNG, valid one-page PDF, simple module, real plugin, dependency-wrapper, and diagnostics routes.
- `proxy-handler.ts`: exact scheme/host/empty-port/no-credentials validation, a direct `undici` `Agent`, streamed request bodies with `duplex: 'half'`, streamed response bodies, manual redirects, and once-only upstream cancellation/finalization.
- `main.ts` and `preload.ts`: pre-ready scheme registration, default-session handler, narrow diagnostics/memory/report IPC, renderer and isolated-partition windows, 25 ms Main/renderer memory sampling, five-second settled sample, cleanup, atomic sibling-write/rename, and exit status.
- `renderer/index.html`, `renderer/partition.html`, and `renderer/index.ts`: strict representative CSP and ordered browser assertions. The current product-CSP absence is recorded separately from the stronger representative fixture policy.
- `prepare-real-plugin.mjs`: copies the built `@cradle/system-info` `web.mjs`, parses imports with `es-module-lexer`, rejects an unknown bare dependency, rewrites the finite shared React map to `cradle-server://local/api/plugins/-/deps/*.mjs`, generates wrappers from actual installed module exports, and emits a digest manifest. Development and packaged modes consume the same prepared bytes.
- `electron.vite.config.ts` and `electron-builder.mjs`: alternate fixture-only Main/preload/renderer entries under `dist/m0`, ASAR packaging under `release/m0`, exact fixture Main metadata, `npmRebuild: false`, and prepared resources under packaged `resources/m0`. Product builder hooks/resources/entitlements are absent.
- `run-m0.mjs`: exact mode parsing, deterministic platform artifact paths, absolute result paths, stale-result removal, 120-second/Windows 180-second timeout, process-tree termination, stdout/stderr logs, result validation, and nonzero failure behavior. It never scans for an arbitrary Electron executable.
- `result-contract.test.ts` and `proxy-handler.test.ts`: result completeness/version drift, exact authority, basic Fetch parity, first-byte delivery, and once-only cancellation/upstream-close coverage.

`apps/desktop/package.json` now exposes the six locked `m0:custom-scheme:*` commands from Exploration A, declares direct `undici@7.25.0`, uses `es-module-lexer@2.3.0` for preparation, and includes fixture renderer React development inputs. The existing `pack` command runs the isolated packaged verifier after the normal product unpacked build. `pnpm-lock.yaml` has only the matching Desktop importer additions.

`.github/workflows/ci.yml` adds the required Linux x64 `desktop-m0-custom-scheme` job with maintained Chromium/Electron system dependencies, Xvfb, the combined development/packaged gate, and compact failure artifacts. `.github/workflows/verify-windows-desktop-package.yml` adds relevant pull-request path triggers, checks out the PR SHA rather than `main`, runs packaged M0 before existing product package E2E, and uploads M0 results/builder config through its existing always-run artifact step. `.github/workflows/release-desktop.yml` runs the same packaged M0 command in the Windows release job before product bundle/installers.

## Assertion and result behavior

Every result is required to contain the complete Exploration A assertion set:

```text
scheme.privileges.exact
scheme.defaultSession.handled
scheme.browserPanelPartition.unhandled
fetch.get.queryAndHeaders
fetch.post.binaryBody
fetch.non2xx.responseParity
response.firstByteBeforeCompletion
response.cancel.invokedOnce
response.cancel.reachesUpstream
request.streaming.multiChunk
multipart.contentTypeAndBytes
binary.64MiB.digestAndLength
binary.64MiB.mainRssBound
binary.64MiB.rendererRssBound
binary.128MiB.nonLinearMainRss
binary.128MiB.nonLinearRendererRss
subresource.image.loads
subresource.dynamicModule.simple
subresource.dynamicModule.realPlugin
subresource.dynamicModule.dependenciesStayCustomScheme
subresource.pdf.arrayBufferReadable
security.strictRepresentativeCsp
security.noBypassCsp
cleanup.activeRequestsZero
cleanup.agentAndServerClosed
```

The renderer uses `response.body.getReader()` for the delayed response and records a minimum 750 ms first-byte lead; it does not use a whole-body helper on that route. Cancellation requires the incoming protocol request signal, exactly one returned-stream `cancel`, exactly one fake-upstream close, zero active proxy work, and stable chunk count after a grace period. Upload uses three 256 KiB renderer stream chunks with 275 ms spacing and `duplex: 'half'`; there is no concatenation fallback.

The 64 MiB and 128 MiB bodies reuse a deterministic 256 KiB upstream buffer and are consumed one chunk at a time with byte count and rolling checksum only. Main RSS and the matching renderer PID working set are sampled every 25 ms and raw samples are retained in JSON. Linux/Windows require each 64 MiB delta below 48 MiB and each 128 MiB delta no more than its 64 MiB delta plus 16 MiB; a missing renderer metric fails. macOS records diagnostics without weakening the Linux/Windows numeric gates.

Main writes JSON to an exact sibling temporary path and renames it only after renderer assertions, partition proof, settled sampling, request cleanup, Agent close, and fake-server close. Missing/malformed results, Electron version drift from 42.4.1, artifact mismatch, any missing/false assertion, timeout, signal, or nonzero exit fail the runner. Result/log files are ignored under `apps/desktop/.m0-results/`; large response bodies are generated and discarded and never uploaded.

## Validation performed

All commands below ran from the repository root unless a working directory is stated.

Passed:

- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — exit 0.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --no-cache` — exit 0.
- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — 2 files, 5 tests passed.
- `node plugins/system-info/node_modules/vite/bin/vite.js build` from `plugins/system-info` — built real `dist/web.mjs` (326.07 kB) and server entry.
- `node src/main/desktop-server-transport/fixtures/m0/prepare-real-plugin.mjs` from `apps/desktop` — prepared the real plugin with three recognized dependencies: `react`, `react-dom`, and `react/jsx-runtime`; emitted rewritten source, wrappers, and digest manifest.
- `NODE_PATH=<apps/desktop/node_modules> node node_modules/electron-vite/bin/electron-vite.js build --config src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts` from `apps/desktop` — built isolated Main (999.77 kB), preload (0.47 kB), index/partition HTML, and renderer bundle (576.99 kB). `NODE_PATH` was needed only because this container's interrupted pnpm global-virtual-store install omitted peer links; committed scripts use the normal clean-install resolution.
- `PNPM_HOME=/tmp/cradle-m0-pnpm XDG_DATA_HOME=/tmp/cradle-m0-xdg XDG_CACHE_HOME=/tmp/cradle-m0-cache pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts` — lockfile current, exit 0.
- Parsed `.github/workflows/ci.yml`, `.github/workflows/verify-windows-desktop-package.yml`, and `.github/workflows/release-desktop.yml` with `js-yaml` — all valid.
- Imported `electron-builder.mjs` and checked `extraMetadata.main`, `asar`, `npmRebuild`, and output directory — pass.
- Static source/bundle search for `main-app`, `server-process`, `createServerApp`, and `DesktopServerTransport` — no fixture dependency.
- `git diff --check` — exit 0.

Runtime limitation, not an M0 assertion result:

- Attempted `node src/main/desktop-server-transport/fixtures/m0/run-m0.mjs --mode development` from `apps/desktop` with the writable pnpm cache variables used above. The runner correctly created its exact log paths, but this already-damaged workspace's pnpm dependency-status repair ran before `@cradle/system-info` build and failed installing unrelated root `better-sqlite3`: node-gyp downloaded Node 24.14.0 headers but tar extraction repeatedly returned `EINVAL: invalid argument, fchown`. The runner exited nonzero at prepare and wrote no success JSON. This did not reach Electron and is not a custom-scheme failure.
- The local `electron@42.4.1` package has no downloaded `dist/electron` executable after the interrupted dependency install, and this container exposes no Xvfb/display binary. Therefore development Electron, fixture packaging/launch, product `pnpm build:desktop`, product `pnpm --filter @cradle/desktop pack`, Linux RSS evidence, and Windows packaged evidence were not locally runnable. Repeating the same install failure was deliberately avoided.
- No GitHub workflow can be dispatched from this implementation node, so Linux/Windows JSON, RSS values, executable paths, and workflow URLs remain pending. Node C/production routing must remain blocked until both required jobs provide passing results.

The failed local launcher evidence is under ignored `apps/desktop/.m0-results/development-linux-x64.stdout.log`; it is not part of the formal handoff and should not be committed.

## Reviewer focus and STOP handling

Review the fixture as feasibility code, not production transport. In particular, verify exact privilege registration happens before readiness, only the default session receives the handler, the partition has no handler, all response/request bodies remain streaming, cancellation has a single upstream owner, the real plugin stays on the custom scheme under CSP, raw memory samples accompany threshold decisions, the runner uses exact artifacts, and CI contains no `continue-on-error` for M0.

If Linux or Windows produces a false assertion, a per-process 64 MiB delta at or above 64 MiB, a 128 MiB linear slope after the one allowed evidence-based correction, missing cancellation/upstream close, a need for `bypassCSP`/`codeCache`/partition access/HTTP fallback, or packaged-only content failure, preserve its JSON/logs and stop. Do not modify production routing, add buffering/private IPC framing, or start Node C. Escalate to the Plan B local HTTP/2-over-TLS decision exactly as Plan 063 requires.

## Handoff quality checklist

- [x] Read the complete root `AGENTS.md`, ExecPlan `docs/exec-plans/20260813-01-desktop-server-transport.md`, Exploration A, and the installed ExecPlan contract; confirmed no Desktop-local AGENTS file exists.
- [x] Limited implementation to Node A fixture/build/scripts/CI ownership and left production Main/Web/Server routing, lifecycle, credentials, Chat, database, and auth behavior unchanged.
- [x] Implemented all 25 named assertions with machine-readable details, exact Electron/privilege/result validation, atomic results, bounded timeouts, logs, cleanup, and deterministic artifact paths.
- [x] Implemented default-session success plus BrowserPanel-shaped persistent-partition denial using both Main- and renderer-side evidence.
- [x] Implemented GET/binary POST/non-2xx, first-byte streaming, cancellation, streamed upload, multipart, deterministic 64/128 MiB transfers, image, valid PDF, simple module, real plugin/dependency, strict CSP, RSS, and cleanup paths without whole-body streaming fallbacks.
- [x] Added direct `undici`, fixture-only plugin preparation, isolated electron-vite/electron-builder configs, ignored generated boundaries, stable package commands, and the product `pack` ratchet.
- [x] Added required Linux Xvfb PR CI, Windows packaged PR/manual CI, and Windows release ratchet with compact evidence uploads and no M0 `continue-on-error`.
- [x] Ran all locally available focused type, lint, unit/integration, real-plugin, bundle, lockfile, YAML, builder-config, isolation, and diff-hygiene validation and recorded exact outcomes.
- [ ] Development and ASAR-packaged Electron 42.4.1 runtime JSON/RSS evidence: blocked before Electron by the local dependency-repair/native-install failure and missing Electron/display binaries; the new Linux/Windows jobs must supply it.
- [ ] Required Windows workflow URL and exact Linux/Windows result measurements: unavailable from this local implementation node and must be recorded by the parent in Plan 063 before Node C.
- [x] Preserved unrelated worktree state: `apps/server/src/http/websocket-ticket.ts` remains untracked and untouched.
- [x] Did not edit the living ExecPlan because the plan assigns cross-node updates to the parent; this file is the complete Implementation A handoff.
- [x] Formal output is this handoff file only.
