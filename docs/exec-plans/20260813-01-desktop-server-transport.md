# Eliminate Desktop renderer HTTP pool starvation with a privileged custom-scheme proxy

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. The repository has no root `PLANS.md`; this plan follows the installed `execplan` skill and its `references/PLANS.md`. Plan 063 remains the product architecture authority; this file turns it into an executable, current-source DAG without weakening its STOP conditions.

## Purpose / Big Picture

After this work, a Desktop renderer—including twenty or more Tearoff windows—does not open ordinary HTTP or SSE connections to the Desktop-owned Cradle Server. Fetch, generated API calls, uploads, downloads, images, PDFs, plugin modules, and fetch-backed SSE use `cradle-server://local`; Electron Main validates those requests, strips renderer credentials, injects the Desktop-owned bearer, and streams them through an undici Agent to the existing Elysia HTTP listener. PTY and `/sync` remain native WebSockets to the network listener and authenticate with a fresh 30-second audience-bound single-use ticket for each connect or reconnect.

The visible proof is a packaged Electron gate and a targeted packaged stress smoke. The M0 gate must show first-byte streaming, cancellation, streamed uploads, bounded 64/128 MiB transfers, multipart, image, PDF, real plugin module loading under CSP, and default-session isolation. The final smoke must show more than six live streams across at least twenty Tearoffs while OS socket ownership records zero renderer HTTP(S) connections to the owned Server port. Main-process undici connections and one ticketed native WebSocket are expected.

The ordinary Server HTTP listener remains the single API contract for the CLI, attached clients, and Desktop Main. This work does not add a private child-process Request/Response protocol, per-route IPC, PTY-over-IPC, a database schema, or new Chat admission/recovery semantics.

## Progress

- [x] (2026-08-12 16:22Z) Read Plan 063, the root repository instructions, the installed `execplan` instructions, current source, package/build workflows, and the existing Web transport scaffold.
- [x] (2026-08-12 16:22Z) Completed three independent exploration nodes and stored their self-contained handoffs under `docs/multi-work/desktop-server-transport/`: packaged M0, Desktop Main/lifecycle, and Web/auth/ratchet.
- [x] (2026-08-12 16:22Z) Reconciled the exploration findings into this ExecPlan and fixed the implementation DAG and architecture decisions below.
- [x] (2026-08-12 16:27Z) Captured the fresh local pre-edit baseline available in the partial dependency install: Desktop direct TypeScript check passed and the focused Web transport suite passed 9/9; Web direct TypeScript check failed at the pre-existing `plugin-host.ts` descriptor nullable-description mismatch before any M0 or production edit.
- [x] (2026-08-12 17:24Z) Implemented Node A's isolated fixture, exact result validator, bounded process-tree runner, direct undici dependency, package commands, and Linux/Windows/release CI gates. The first two independent reviews failed the evidence validator and two generations of timeout cleanup; both defects and the authority/privilege ratchets were fixed, and Review C passed code readiness after a repeated parent-exits/descendant-ignores adversarial probe.
- [x] (2026-08-13 13:45JST) Published the first M0 revision on draft PR #163. Linux run 31622852716/job 94201758906 reached Electron 42.4.1 but aborted before fixture startup because the hosted runner's pnpm `chrome-sandbox` is not root-owned/mode 4755. Added the permitted, fail-closed Linux-GitHub-Actions-only process `--no-sandbox` launch policy; both BrowserWindows remain `sandbox: true`, focused tests now pass 15/15, and independent Review D passed the narrow code-readiness correction. Corrected runtime evidence is still pending.
- [ ] Diagnose the first Windows packaged run 31622852684/job 94201752466: the artifact built and its launcher returned code 0 after about 13 seconds, but no result JSON or stdout/stderr was produced. Treat this as a runtime failure and observability gap, not acceptance; preserve the next run's exact process/fixture evidence.
- [ ] Execute M0 in development and an ASAR-packaged unpacked Electron 42.4.1 artifact, record exact artifacts/RSS/cancellation evidence, and stop if it fails.
- [ ] Implement and review Node B, HTTP/auth/ticket characterization fixtures.
- [ ] Implement and review Node C, the connection discriminant, credential owner, undici transport, generation fencing, and protocol handler.
- [ ] Implement and review Node D, Desktop lifecycle/status and all Main Server-consumer migrations.
- [ ] Implement and review Node E, Web base/fetch/SSE/subresource migrations and renderer-bearer removal.
- [ ] Implement and review Node F, the static transport-boundary ratchet and documentation.
- [ ] Implement and review Node G, the packaged twenty-Tearoff/socket-ownership smoke.
- [ ] Run focused and repository-wide validation, update Plan 063 and `plans/README.md`, then commit, push, and open a draft pull request.

## Surprises & Discoveries

- Observation: the Web transport is useful scaffold, not a working Desktop route. Desktop ready status has no connection projection and no Main custom-scheme handler exists, so Web correctly falls back to the loopback HTTP URL.
  Evidence: `apps/desktop/src/shared/server-runtime.ts`, `apps/desktop/src/main/main-app.ts`, and `apps/desktop/src/main/server-process.ts` publish only a URL string; there is no `apps/desktop/src/main/desktop-server-transport/` production module.
- Observation: a module-level Chat constant captures the HTTP Server base before Desktop readiness and several hand-written Server requests bypass `cradleFetch`.
  Evidence: `apps/web/src/features/chat/commands/chat-response-command.ts` initializes `SERVER_BASE` at module evaluation and uses ambient fetch; assets, Chronicle/search/devtool, and workspace PDF paths also contain unclassified raw Server fetches.
- Observation: current locator health proves reachability but not credential ownership because `/health` is public.
  Evidence: `apps/server/src/http/auth.ts` exempts `/health`, while `server-process.ts` currently treats a healthy locator as reusable without a protected probe.
- Observation: child restart reuses the same URL and credential but neither increments a generation nor republishes a final ready status; shutdown can race a scheduled replacement spawn.
  Evidence: the current `spawnServer()` exit path recursively starts another child without an active-operation owner or shutdown epoch.
- Observation: the fetch-backed SSE adapter is already the only production EventSource path, but headers-open loops reset backoff, object listener removal loses identity, empty `id:` does not reset, and body readers are not explicitly cancelled/released.
  Evidence: `apps/web/src/lib/server-transport/fetch-event-source.ts` and its two-test suite.
- Observation: the existing single-use ticket design already fits PTY and `/sync`; cookie bootstrap is unnecessary. The remaining task is to prove fresh issuance/consumption and ensure custom-scheme resources mint no HTTP(S) resource ticket.
  Evidence: `apps/server/src/http/single-use-ticket.ts`, `apps/server/src/http/auth.ts`, PTY and sync routes, and `apps/web/src/lib/authenticated-server-url.ts`.
- Observation: the worktree contains an unrelated untracked `apps/server/src/http/websocket-ticket.ts`, apparently an older duplicate of tracked `single-use-ticket.ts`.
  Evidence: `git status --short`. It is user/overlay state, must remain untouched, and must never be staged.
- Observation: the fresh local Web typecheck does not reproduce the earlier green CI baseline because the current partial install resolves a `PluginDescriptor` type whose `description` excludes `null`.
  Evidence: `node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json` fails at `apps/web/src/lib/plugin-host.ts:174`; the immediately preceding Desktop direct TypeScript check passed and the focused Web transport run then passed 9/9. Treat this as an unresolved baseline/dependency fact, not as one of the two accepted Chat Runtime failures and not as permission to edit plugin semantics inside M0.
- Observation: a launcher can report its direct process exited while leaving a signal-ignoring descendant in the same process group; clearing escalation timers on the direct exit made the advertised timeout untrue.
  Evidence: Review B reproduced the orphan after the first timeout fix. The accepted runner retains the captured group identifier and timeout-owned settlement until group `SIGKILL` and bounded force settlement; Review C repeated the adversarial shape five times with no surviving descendant.
- Observation: GitHub's Ubuntu Electron install cannot use its SUID sandbox because the package-provided `chrome-sandbox` is not root-owned with mode 4755.
  Evidence: run 31622852716/job 94201758906 reached development Electron and aborted in `setuid_sandbox_host.cc:166` before writing a result. The accepted correction enables Electron's process-level no-sandbox switch only for an exact request on Linux GitHub Actions, records the observed switch in the result contract, and retains sandboxed/context-isolated BrowserWindows. Review D passed code readiness but no corrected runtime has passed yet.
- Observation: the first Windows packaged launcher returned success without a fixture result or captured output.
  Evidence: run 31622852684/job 94201752466 built and signed `release/m0/win-unpacked/cradle-m0-gate.exe`, invoked it for about 13 seconds, then failed reading the absent `.m0-results/packaged-win32-x64.json`; artifact upload confirmed that `.m0-results` contained no files. Root cause remains under diagnosis and must not be hidden behind a second ENOENT-only failure.

## Decision Log

- Decision: M0 is a separate fixture-only Electron application under `apps/desktop/src/main/desktop-server-transport/fixtures/m0/`, with its own electron-vite and electron-builder configurations.
  Rationale: it must prove Electron/package behavior without starting production Server, CLI, database, migration, or credential code, and without accidentally routing production traffic before the hard gate passes.
  Date/Author: 2026-08-13 / Codex
- Decision: register only `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, and `stream`; leave `codeCache`, `bypassCSP`, service workers, and extension access disabled.
  Rationale: these are the locked least-privilege capabilities. `codeCache` may change only if the packaged real-plugin proof demonstrates it is required; `bypassCSP` is a STOP condition.
  Date/Author: 2026-08-13 / Codex
- Decision: use a stable Main-owned transport object and a fresh undici Agent for every owned child generation. Allocate monotonically increasing generation numbers per spawn attempt and publish only successful ready generations.
  Rationale: consumers must not retain stale URL/fetch closures, and same-port restart must not reuse pooled sockets from the prior process.
  Date/Author: 2026-08-13 / Codex
- Decision: use protected `GET /preferences/desktop` as the side-effect-free attached Main-bearer probe after public `/health` establishes reachability.
  Rationale: it already exists, is read-only, and runs through normal auth. A located Server remains `attached-http` even when this probe permits `main-proxy`.
  Date/Author: 2026-08-13 / Codex
- Decision: do not create a new browser-session bootstrap. An attached endpoint that passes unauthenticated protected probing may use `direct-http` with authentication `none`; an auth-required locator uses `main-proxy` only when Main's bearer passes the protected probe, otherwise it fails closed. The union retains `browser-session` for an already verified future adapter, but this plan does not invent verification.
  Rationale: renderer bearer removal must not be weakened to preserve an unproven attached mode.
  Date/Author: 2026-08-13 / Codex
- Decision: Desktop does not terminate a reused `attached-http` process on shutdown; only a process spawned by this Desktop has owned lifecycle.
  Rationale: the connection discriminant must match stop/restart behavior. Locator reuse is attachment, not retrospective ownership.
  Date/Author: 2026-08-13 / Codex
- Decision: an unavailable custom-scheme request returns HTTP 503 with `application/problem+json` and the stable code `desktop_server_unavailable`; it never contains a URL, token, or fallback location.
  Rationale: all windows share a handler installed before readiness, so unavailable behavior must be deterministic and non-sensitive.
  Date/Author: 2026-08-13 / Codex
- Decision: Main uses `redirect: 'manual'` for upstream undici calls. Relative/same-authority redirects are returned to Chromium and re-enter the exact custom handler; an absolute cross-scheme redirect is not followed by Main and therefore never receives the injected bearer.
  Rationale: this preserves browser-visible redirect semantics without credential forwarding to arbitrary origins.
  Date/Author: 2026-08-13 / Codex
- Decision: the public consumer capability is `fetch(request: Request): Promise<Response>`. A private lifecycle owner provides activation, invalidation, diagnostics, and disposal; features cannot choose target URLs or credentials.
  Rationale: one normalized Request boundary makes body/signal/header behavior auditable and prevents optional ambient fetch fallbacks.
  Date/Author: 2026-08-13 / Codex
- Decision: the Web Desktop status listener stays active after initial readiness and applies later connection projections, while the runtime custom base remains stable across owned generations.
  Rationale: restart must be observable and diagnostics must not remain pinned to a stale generation, even when the listener port is reused.
  Date/Author: 2026-08-13 / Codex
- Decision: the boundary checker uses the TypeScript AST plus exact non-Server manifests and rejects stale allowlist entries.
  Rationale: grep-only checks miss aliases and encourage broad exemptions; the policy must classify each constructor, destination, and reason.
  Date/Author: 2026-08-13 / Codex
- Decision: permit the M0 launcher to request Electron `--no-sandbox` only when the request is exactly `CRADLE_M0_NO_SANDBOX=1` on a Linux GitHub Actions runner; reject all other requested environments and require emitted launch evidence to match.
  Rationale: this is the hosted-runner exception anticipated by the M0 plan. It does not change production launchers or the two fixture BrowserWindows' `sandbox: true`, context isolation, disabled Node integration, and web security settings.
  Date/Author: 2026-08-13 / Codex

## Outcomes & Retrospective

Node A implementation and code review are complete, but runtime M0 is not accepted. The fixture, package/workflow gates, exact evidence validator, bounded launcher, and narrowly reviewed Linux runner launch policy are ready; local focused tests are 15/15, Desktop direct typecheck and fixture lint pass, and the isolated bundle builds. The first hosted runs did not reach behavior acceptance: Linux hit the anticipated SUID sandbox runner condition, while Windows returned from the packaged launcher without a result and needs an evidence-preserving diagnosis. Production routing remains unchanged until corrected Linux development/packaged and Windows packaged results pass. If the custom-scheme behavior itself fails after the allowed evidence-based correction, this plan stops with measurements; Plan B is a separate local HTTP/2-over-TLS decision, never private process framing.

## Context and Orientation

`apps/desktop/src/main/index.ts` is the earliest Electron Main entry. It currently loads environment state and dynamically imports `main-app.ts`. Privileged scheme registration must execute synchronously here before any path can reach `app.ready`.

`apps/desktop/src/main/main-app.ts` owns application startup, windows, Server-dependent Main services, status publication, and shutdown. It currently creates the main window before starting the Server and passes `--server-auth-token` to that window. It must create the stable transport, install the default-session handler before any window loads, start or attach the Server, activate the transport, publish the discriminated ready status, inject the transport into consumers, and tear everything down in a bounded order.

`apps/desktop/src/main/server-process.ts` owns the credential file, locator probing, managed child spawn, listener/bootstrap readiness, restart, and stop. It currently returns `Promise<string>`. It must return `DesktopServerConnection`, distinguish located from spawned processes, use a protected attached-auth probe, fence stale exits/restarts, and notify Main when an owned generation becomes unavailable or ready. Bootstrap/control IPC remains unchanged and never carries HTTP bodies.

The new `apps/desktop/src/main/desktop-server-transport/` boundary owns `connection.ts`, private credential access, the undici proxy, scheme registration, protocol handler, diagnostics, and a narrow index. `protocol.handle` is installed only on `session.defaultSession`; BrowserPanel uses `persist:cradle-browser-*` partitions and must never receive it.

`apps/desktop/src/shared/server-runtime.ts` carries the ready connection projection through preload into Web. The target discriminant is:

    type DesktopServerConnection =
      | { kind: 'owned-proxy'; rendererTransport: 'main-proxy'; serverUrl: string; rendererBaseUrl: 'cradle-server://local'; generation: number; mainProxyTarget: string }
      | { kind: 'attached-http'; rendererTransport: 'main-proxy'; serverUrl: string; rendererBaseUrl: 'cradle-server://local'; mainProxyTarget: string; authentication: 'main-bearer' }
      | { kind: 'attached-http'; rendererTransport: 'direct-http'; serverUrl: string; rendererBaseUrl: string; authentication: 'browser-session' | 'none' }

The long-lived bearer remains private to Main. It is used only for the Server child environment, protected attached probing, and proxy injection. It must not appear in the connection value, status, window arguments, preload environment, Web ambient types, errors, logs, or diagnostics.

`apps/web/src/lib/server-transport/base-url.ts` already separates renderer and network bases. `server-readiness.ts` already trusts Desktop status rather than renderer health polling. `server-credential.ts` already rebases generated-client requests and strips standard credentials for the custom scheme. These modules need a complete shared projection, persistent restart updates, complete credential-header stripping, and conformance tests.

`apps/web/src/lib/server-transport/fetch-event-source.ts` is the production SSE transport. It parses SSE over fetch and is already used instead of native EventSource, but needs listener identity, empty-ID reset, retry/backoff, UTF-8 flush, abort, reader cancellation/release, and reconnect-disposal correctness.

`apps/server/src/http/auth.ts` and `single-use-ticket.ts` are the unchanged auth contract. Ticket issuance is bearer-authenticated HTTP; a native WebSocket URL receives only a 30-second audience-bound single-use ticket. Resource tickets remain only for explicit HTTP(S) browser/attached fallback. In custom-scheme mode, images, PDFs, asset content, and plugin modules use the custom URL directly.

Main Server consumers are desktop preferences, both Chat brokers, plugin source/dev-session sync, observability reporting, tray, notification center, and Server readiness diagnostics. `browser-manager.ts` probing an arbitrary local browser target is the named non-Server Main exception. Web hand-written Server consumers include Chat command streams, asset upload, Chronicle/search/devtool reads, PDF reads, and existing binary/plugin paths. User-entered endpoint health checks, external changelog/tip requests, and data-URL conversion are named non-owned exceptions.

## Plan of Work

The implementation is a dependency DAG with one hard gate.

Node A implements the isolated M0 fixture and its result runner. It adds a fake loopback upstream, exact privileged scheme, fixture-only undici Agent, default and partition windows, strict representative CSP, real plugin module preparation, streaming/cancellation/RSS instrumentation, fixture build/package configuration, package scripts, and Linux/Windows CI integration. It writes atomic JSON results and exits nonzero for every failed assertion. An independent review checks isolation, security, thresholds, commands, and STOP conditions. The development and packaged runs must pass before Nodes C-E change production routing.

Node B adds characterization tests and reusable fake HTTP/auth fixtures. It covers JSON/errors, redirects, empty bodies, repeated headers, SSE, range/binary, multipart, request/response abort, slow consumption, ticket issuance/expiry/audience/path/single-use, connection-mode facts, and the unchanged snapshot-first Chat transport boundary. This may be prepared while remote M0 CI runs because it does not change production routing, but its fixtures must not create a dependency from production code to the M0 application.

Node C creates the connection and transport owner. It adds direct `undici` dependency, Request/Response streaming conversion, generation-scoped Agent and active-operation tracking, exact cancellation, manual redirects, credential stripping/injection, deterministic unavailable response, exact authority validation, pre-ready registration, default-session handler installation, and partition denial. It tests same-port restart, stale child exit, abort races, body-stream invalidation, no mutation replay, repeated headers, and agent cleanup.

Node D refactors lifecycle and Main consumers. `startServer()` returns the discriminant; located processes remain attached and use the protected probe; owned restart increments generation, publishes unavailable/starting/fresh bootstrap/ready, and cannot outlive shutdown. The stable transport is injected into every Server consumer, all ambient Server fetch/auth selection is removed, reporter/timers are stopped, and only `browser-manager.ts` retains a reviewed non-Server global fetch. Main, Tearoff, and DevTools bearer arguments are removed only after Node C and ticket issuance work.

Node E completes Web and auth migration. It aligns the shared projection, keeps status subscription active, removes `serverAuthToken` from preload/Web, strengthens `cradleFetch`, migrates raw Server fetches, resolves Chat base per request, fixes the SSE adapter, makes custom-scheme resources mint no ticket, preserves HTTP(S) fallback tickets, and proves fresh exact-audience PTY/sync tickets. It exercises generated JSON, FormData, image, PDF, binary, plugin descriptor and dynamic module paths against the production handler.

Node F adds the AST boundary ratchet, exact manifest, unit fixtures, and affected Desktop/Web/Chat/PTY documentation. It rejects renderer bearer exposure, unclassified ambient fetch, native EventSource, unreviewed WebSocket/network-base use, resource-ticket misuse, `owned-ipc`, and private HTTP process framing. It allows only exact named exceptions and fails when an exception becomes stale.

Node G extends the packaged launcher into the targeted twenty-Tearoff smoke. It opens unique sessions/Tearoffs, keeps more than six distinct streams active, performs representative JSON/multipart/binary/image/PDF/plugin traffic, opens one ticketed PTY WebSocket, cancels/cleans half, restarts the owned Server, proves generation fencing/no mutation replay/existing cursor recovery, and finally closes everything. Main redacted diagnostics and OS socket sampling independently prove zero renderer HTTP(S) sockets to the owned Server port and zero leaked active proxy operations.

Each node receives the ExecPlan and related files directly, writes a self-contained `docs/multi-work/desktop-server-transport/20260813-...-{Implementation|Review|Fix}X.md` handoff, and is independently reviewed. Failed reviews receive a bounded Fix node and re-review. Architectural failures return an escalation instead of a patch-around. Main owns cross-node merges, ExecPlan updates, and final reporting.

## Concrete Steps

Run commands from the repository root. Preserve the unrelated untracked `apps/server/src/http/websocket-ticket.ts`; stage only explicit Plan 063 paths.

Before every delivery slice, run Plan 063's drift command and inspect:

    git diff --stat d40f895e..HEAD -- apps/desktop/src/main apps/desktop/src/preload apps/desktop/src/shared/server-runtime.ts apps/desktop/electron.vite.config.ts apps/desktop/electron-builder.mjs apps/desktop/package.json apps/server/src/index.ts apps/server/src/bootstrap-lifecycle.ts apps/server/src/app.ts apps/server/src/http apps/server/src/modules/pty apps/server/src/modules/sync-gateway apps/server/package.json apps/web/src/api-gen apps/web/src/lib/authenticated-server-url.ts apps/web/src/lib/plugin-host.ts apps/web/src/lib/server-credential.ts apps/web/src/lib/server-transport apps/web/src/features/chat apps/web/src/features/download-center/transport.ts apps/web/src/features/tui/pty-channel.ts apps/web/src/features/workspace/file-tree.tsx apps/web/src/lib apps/web/src/main.tsx apps/web/src/tearoff-main.tsx apps/web/src/env.d.ts e2e packages .github/workflows package.json pnpm-lock.yaml

Record baseline before production edits:

    pnpm --filter @cradle/desktop typecheck
    pnpm --filter @cradle/web typecheck
    pnpm exec vitest run --config apps/web/vitest.transport.config.ts apps/web/src/lib/server-transport apps/web/src/lib/authenticated-server-url.test.ts
    pnpm --filter @cradle/server test
    pnpm test

M0 user-facing commands to add and run are:

    pnpm --filter @cradle/desktop m0:custom-scheme:dev
    pnpm --filter @cradle/desktop m0:custom-scheme:packaged
    pnpm --filter @cradle/desktop m0:custom-scheme:gate
    pnpm build:desktop
    pnpm --filter @cradle/desktop pack

On Linux CI, prefix the fixture gate with `xvfb-run -a` after installing maintained Electron/Chromium shared libraries. The packaged Linux executable is `apps/desktop/release/m0/linux-unpacked/cradle-m0-gate`; the Windows executable is `apps/desktop/release/m0/win-unpacked/cradle-m0-gate.exe`. Store JSON/logs under ignored `apps/desktop/.m0-results/` and upload them on CI failure. Record exact launch command, artifact path, Electron version, platform, RSS samples, cancellation counters, and workflow URL in this plan and Plan 063 before Node C begins.

Focused implementation commands are:

    pnpm exec vitest run apps/desktop/src/main/desktop-server-transport --maxWorkers=1
    pnpm exec vitest run apps/desktop/src/main/server-process.test.ts apps/desktop/src/shared/server-runtime.test.ts apps/desktop/src/main/chat-stream-broker.test.ts apps/desktop/src/main/chat-event-tail-broker.test.ts apps/desktop/src/main/tray-manager.test.ts apps/desktop/src/main/notification-center-manager.test.ts --maxWorkers=1
    pnpm exec vitest run --config apps/web/vitest.transport.config.ts apps/web/src/lib/server-transport apps/web/src/lib/authenticated-server-url.test.ts apps/web/src/lib/server-credential.test.ts
    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/server check:boundaries
    pnpm --filter @cradle/desktop typecheck
    pnpm --filter @cradle/web typecheck

Final validation is:

    pnpm --filter @cradle/server test
    pnpm --filter @cradle/web test
    pnpm test
    pnpm lint
    pnpm build:desktop
    pnpm --filter @cradle/desktop pack
    git diff --check
    git status --short

Run the packaged twenty-Tearoff command added by Node G on every release platform available in CI. The exact script name and artifact path must be added here when the node lands; do not accept a generic Cucumber/browser smoke as substitute evidence.

## Validation and Acceptance

M0 passes only when development and the ASAR-packaged unpacked artifact produce valid atomic result JSON with every named assertion true. Electron is exactly 42.4.1. GET/POST/non-2xx, first-byte streaming, end-to-end cancellation, streamed upload, multipart bytes/content type, 64 MiB digest and bounded RSS, 128 MiB non-linear canary, image, representative PDF, simple and real plugin dynamic imports, strict CSP without bypass, default-session handling, partition denial, and zero active requests after cleanup are mandatory. Initial per-process 64 MiB peak growth is below 48 MiB and the 128 MiB peak adds no more than 16 MiB; one evidence-backed calibration is allowed only while keeping each delta below 64 MiB and the slope below 16 MiB.

Proxy parity requires GET/POST/PATCH/DELETE/HEAD, query, redirects, JSON and existing errors, empty 204/304, text, binary/range, multipart, SSE, repeated headers including `set-cookie`, slow-consumer backpressure, and abort before headers/mid-request/mid-response/after completion. Main follows no redirects, strips all standard and Cradle credential headers, injects exactly the current bearer, preserves status/statusText/headers/body streaming, and never buffers for convenience.

Connection tests prove a spawned child cannot be published as owned before listener/bootstrap readiness; a locator is always attached; auth-required direct HTTP cannot exist without verified browser ownership; protected attached probing decides Main proxy; failed owned generations never become ready; restarts allocate a fresh Agent/generation; stale exits do not affect newer children; pending mutations fail without replay; shutdown cannot spawn a replacement; attached processes are not terminated.

Electron protocol tests prove exact protocol/hostname/empty port/no credentials, deterministic unavailable state, default-session-only registration, partition denial, manual redirect security, streaming cancellation, and no fallback. Renderer-visible surfaces contain no bearer in argv, preload, environment, errors, logs, or diagnostics.

SSE tests cover LF/CRLF, comments, blank/multiline/named/default events, ID and empty-ID reset, retry, split UTF-8 with final decoder flush, Request/signal/cursor construction, abort at each lifecycle stage, natural EOF/HTTP/missing-body/read errors, reconnect policy/backoff, object listener identity, exact reader cancellation/release, and no reconnect after disposal. Feature parsers retain malformed-payload ownership.

Ticket tests prove bearer-authenticated issuance, 30-second expiry, exact audience/path, GET-only resource use, prevalidation without consumption, one consumption, fresh reconnect issuance, wrong PTY/sync path denial, and redaction. Custom-scheme resources mint zero tickets. PTY and `/sync` remain the only reviewed native WebSocket paths.

The ratchet fails on any new renderer credential, owned HTTP(S) fetch/EventSource, Main ambient Server fetch, unclassified Web raw Server fetch, unreviewed network-base/resource-ticket/WebSocket use, `owned-ipc`, private Request/Response framing, or per-route Desktop IPC. Exact external/data/endpoint-health/browser-target exceptions pass and stale entries fail.

The packaged stress gate opens at least twenty unique Tearoffs and more than six independent streams, performs representative traffic plus one native ticketed PTY WebSocket, closes/restarts/resumes, and returns active transport state to zero. OS socket samples by renderer PID and exact Server port plus Main scheme diagnostics show zero renderer HTTP(S) connections throughout. Missing or unclassifiable socket evidence is a failure, not an observational success.

Repository-wide Server/Web/root tests, lint, Desktop build/package, and diff hygiene pass. Only the two exact pre-existing Chat Runtime failures reproduced before edits may remain recorded; no new failure is reclassified as baseline.

## Idempotence and Recovery

The M0 application writes only ignored build, release, and result paths and uses a fake loopback upstream. Its runner deletes only its exact stale result file, writes a sibling temporary file, atomically renames on success, imposes a bounded timeout, and owns cleanup of its exact child processes. Re-running it must produce a fresh result without touching production state.

Production transport activation is generation-based. Invalidation aborts every old operation exactly once, destroys the old Agent, and makes the protocol return unavailable until a new ready connection activates. No transport-level request is replayed. Existing feature policy may reconnect/resume reads after a new generation; mutations fail and callers decide what to do. A response whose headers already resolved must receive a body-stream error/cancel rather than a false claim that the original promise was rejected.

Shutdown first fences restart, stops producers/timers, invalidates transport, removes or disables the protocol handler after renderer teardown, then stops only an owned child. Cleanup must fit inside the coordinated Main force-exit budget. A reused attached process and locator are not destroyed by this Desktop.

If M0 or a packaged smoke fails, preserve its JSON/log/measurements, leave production routing unchanged or revert only the failed in-progress slice using explicit path edits, and stop. If a review exposes architecture drift, return an escalation; do not add HTTP fallback, buffering, `bypassCSP`, BrowserPanel access, ticket weakening, or private framing.

## Artifacts and Notes

Exploration handoffs:

    docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-ExplorationA.md
    docs/multi-work/desktop-server-transport/20260813-desktop-main-transport-ExplorationB.md
    docs/multi-work/desktop-server-transport/20260813-web-auth-ratchet-ExplorationC.md

These files are intentionally separate from this ExecPlan and are ignored by the repository's `/docs` rule. They remain workflow handoffs, not the source of truth required to execute this self-contained plan.

Current baseline is Plan 063's `d40f895e`. The branch currently contains only the replan commit over that baseline. The worktree's untracked `apps/server/src/http/websocket-ticket.ts` is unrelated and must remain unstaged. Use explicit `git add <paths>` only; never `git add -A`.

The existing CI run named by Plan 063 shows Desktop build/typecheck/lint success and two pre-existing Chat Runtime failures. Fresh pre-edit reproduction is still required where the current environment permits it. The present Work container has no display server, so local bundle/typecheck evidence cannot satisfy M0. Linux Xvfb and the Windows packaged workflow are the required runtime evidence.

## Interfaces and Dependencies

`DesktopServerTransport` is the only feature-facing Main HTTP interface:

    interface DesktopServerTransport {
      fetch(request: Request): Promise<Response>
    }

The private owner also exposes activation with `DesktopServerConnection` plus bearer, invalidation with a generation/cause, read-only redacted diagnostics, and disposal. These methods are not feature dependencies. The active registry distinguishes awaiting headers from streaming response bodies and records only method, redacted pathname class, generation, byte/chunk counts, timing, and cancellation reason.

The scheme handler accepts only `cradle-server://local` with no username, password, or port. It strips `authorization`, `cookie`, `proxy-authorization`, `x-cradle-token`, `x-cradle-relay-token`, and reviewed future Cradle credential headers before injecting `Authorization: Bearer <Main-owned token>`. It delegates one normalized Request to the transport and returns one standard streaming Response.

Desktop ready status includes the complete connection projection and bootstrap snapshot. Preload exposes status only. Web uses `rendererBaseUrl` for HTTP/SSE/subresources and `serverUrl` only through the authenticated PTY/sync WebSocket helper. Endpoint settings continue to accept only HTTP(S); `cradle-server:` is an internal runtime base, never persisted user input.

The Desktop package has a direct `undici` dependency. Production never imports fixture code. The M0 fixture may prepare a real plugin bundle and wrappers but must not import Server runtime, `main-app.ts`, the locator, database, or credential state.

The Server HTTP/auth/ticket surface is unchanged except for tests or a narrowly justified redaction/boundary correction. Elysia auth, validation, CORS, request IDs, errors, and route middleware continue to run on every proxied request. No database or generated API schema change is planned.

Revision note (2026-08-13): Created from the three Multi-Work exploration handoffs and current source. Locked M0 as the packaged predecessor, resolved attached-auth/shutdown/redirect/unavailable/status-listener decisions, and decomposed M1-M7 into independently reviewed DAG nodes.

Revision note (2026-08-13 17:24Z): Recorded Node A code completion, two failed review/fix loops, the final code-readiness pass, focused validation, and the still-unmet Linux/Windows Electron runtime gate. Production migration remains blocked.

Revision note (2026-08-13 13:45JST): Recorded the first hosted Linux and Windows runtime failures, the independently reviewed Linux-only sandbox launch correction, 15/15 focused tests, and the unresolved Windows no-result observability failure. No production routing work has begun.
