# Review A: Plan 063 Node A packaged custom-scheme feasibility gate

**Review date:** 2026-08-13
**Reviewed scope:** Plan 063 M0 / ExecPlan Node A only
**Verdict:** **FAIL**
**Disposition:** Node A is not accepted. Do not begin Node C or route production traffic through `cradle-server://local`.

The fixture architecture is directionally compliant and the locally executable static/focused checks pass, but the M0 gate is not trustworthy or complete yet. Two implementation defects weaken the gate itself, and the mandatory development plus ASAR-packaged Linux/Windows runtime evidence does not exist. No observed custom-scheme failure currently justifies Plan B; this is a fix-and-rerun outcome, not an architecture escalation.

## Sources reviewed

I read the complete source documents directly:

- `plans/063-eliminate-desktop-server-sockets.md`
- `docs/exec-plans/20260813-01-desktop-server-transport.md`
- `docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-ExplorationA.md`
- `docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-ImplementationA.md`
- root `AGENTS.md`, `apps/server/AGENTS.md`, `e2e/AGENTS.md`, the installed ExecPlan skill, and its complete `references/PLANS.md`

I also inspected the complete fixture source under `apps/desktop/src/main/desktop-server-transport/fixtures/m0/`, its generated Main/preload bundle where present, Desktop package and lockfile changes, all three modified workflows, the product build/package configs, git status/diff, and the baseline drift range. The unrelated untracked `apps/server/src/http/websocket-ticket.ts` remains untouched.

## Blocking defects

### B1. The result validator accepts malformed evidence and therefore does not enforce the promised JSON contract

`apps/desktop/src/main/desktop-server-transport/fixtures/m0/result-contract.mjs:47-109` checks only that `memory`, `counters`, and `launch` are objects. It does not validate any required nested fields or types: platform/architecture, 256 KiB chunk size, baselines, peaks, settled values, either raw trace, numeric samples, required counters, sandbox state, or assertion `details`. It also does not require the assertion set to be exact.

The weakness is encoded as a passing test: `result-contract.test.ts:10-32` calls a result with `memory: {}`, `counters: {}`, and `launch: {}` “complete” and expects acceptance. An independent direct probe also returned `{ ok: true, errors: [] }` for such an object, even with every assertion lacking `details`.

This contradicts the implementation handoff's claim that malformed results fail and violates Exploration A's minimum result schema, raw-sample requirement, RSS decision evidence, cancellation/session counters, and renderer-sandbox launch record. Because `run-m0.mjs:164-169` relies on this validator as the final artifact gate, a truncated or structurally invalid result can be reported as validated M0 evidence.

This is blocking even though `main.ts` currently intends to write the fuller shape: the runner is the CI trust boundary and must independently reject missing/malformed evidence. The corrected contract must validate all required fields, finite/non-negative numeric values, non-empty time-ordered raw traces, required counters and launch facts, and assertion detail records. RSS/counter invariants should either be recomputed from validated raw evidence or cross-checked against the named assertion details so the artifact cannot assert pass while contradicting its own samples.

### B2. The advertised 120/180-second launcher timeout is not a hard bound on POSIX

`run-m0.mjs:79-97` marks a run timed out and sends termination, but the promise resolves only on the child `exit` event. `terminateProcessTree()` at lines 41-57 sends one `SIGTERM` on POSIX and has no bounded grace period, `SIGKILL` escalation, or forced promise settlement. A hung `electron-vite`/Electron process or descendant that ignores or fails to process `SIGTERM` therefore leaves `runCommand()` pending indefinitely; the code at lines 156-159 that reports a timeout is never reached.

This violates the Node A requirement that the runner impose a bounded timeout and own cleanup of its exact process tree. GitHub's 20-minute job timeout is not a substitute for the fixture's 120-second contract and can also prevent the promised sibling logs/results from being finalized. The launcher needs bounded TERM-to-KILL escalation and deterministic settlement/cleanup on timeout and spawn errors.

## Runtime evidence still required

This section is an acceptance blocker distinct from the two code defects.

Plan 063 and the ExecPlan make M0 a hard predecessor: both development Electron and an ASAR-packaged unpacked artifact must emit valid passing JSON, with Linux and Windows packaged results recorded before production migration. The worktree contains no development or packaged result JSON, no `release/m0` artifact, and no GitHub run URL. The only local `.m0-results` files are logs from a preparation failure that occurred before Electron launched.

The implementation handoff accurately discloses that it has no Electron runtime result, Linux RSS values, Windows packaged result, artifact paths recorded by successful JSON, cancellation counters from Electron, or workflow URL. Consequently none of the following feasibility claims has runtime acceptance evidence yet:

- first-byte custom-scheme response streaming in development and ASAR packaging;
- automatic renderer abort propagation, exactly one returned-stream cancellation, exactly one upstream close, and zero leaked work;
- renderer `ReadableStream` upload timing with `duplex: 'half'`;
- multipart preservation;
- 64 MiB Main/renderer peak deltas below 48 MiB and 128 MiB non-linear deltas within the +16 MiB slope bound, with raw 25 ms traces;
- image, representative PDF, simple module, and real system-info plugin/dependency loading under the representative CSP;
- default-session success and persistent BrowserPanel-partition denial in Electron;
- deterministic launch of the exact Linux and Windows packaged executable under Electron 42.4.1;
- clean Agent/server shutdown after the packaged run.

After B1 and B2 are corrected, the required evidence is:

1. Linux x64 CI: `xvfb-run -a pnpm --filter @cradle/desktop m0:custom-scheme:gate`, yielding both development and packaged passing JSON plus logs and raw memory traces.
2. Windows x64 package workflow at the exact feature SHA: `pnpm --filter @cradle/desktop m0:custom-scheme:packaged`, yielding passing JSON, the deterministic `release/m0/win-unpacked/cradle-m0-gate.exe` path, builder config, and a recorded workflow URL.
3. The required repository evidence `pnpm build:desktop` and `pnpm --filter @cradle/desktop pack`, with the latter proving its appended packaged M0 ratchet.
4. Exact Electron version, platform, artifact paths, RSS measurements, cancellation/session counters, and workflow URLs recorded in Plan 063 and the living ExecPlan before Node C is authorized.

## Requirement and invariant review

| Area | Review status | Evidence and limits |
| --- | --- | --- |
| Fixture isolation | **PASS (static)** | The fixture has separate Main/preload/renderer/vite/builder entries and fake loopback upstream. Source and existing bundle searches find no product `main-app`, `server-process`, Server runtime, locator, Chat, credential, or future production transport import. Production routing is unchanged. |
| Locked architecture | **PASS (static)** | Direct `undici@7.25.0` `Agent` streams to `node:http`; there is no private Request/Response process framing, per-route RPC, PTY IPC, Server `app.handle`, database change, renderer HTTP fallback, `owned-ipc`, or Chat recovery change. |
| Scheme privileges | **PASS (current source)** | `main.ts:26-35` registers exactly `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, and `stream` at module evaluation before `app.whenReady()`. No `codeCache`, `bypassCSP`, service-worker, or extension privilege is enabled. Runtime proof remains pending. |
| Authority and fallback security | **PASS (implementation), test gap** | `proxy-handler.ts:39-51` checks exact protocol, hostname `local`, empty port, and no username/password, returns 400 on failure, and has no fallback. The focused test covers only a wrong host, not port/credentials; see N1. |
| Session boundary | **PASS (implementation), runtime pending** | The handler is installed only on `session.defaultSession`; `persist:cradle-browser-m0` checks both Main-side unhandled state and renderer fetch/image rejection. `partitionHits` stays zero. Actual Electron evidence is pending. |
| Renderer sandbox/CSP | **PASS (static), runtime pending** | Both windows set `sandbox: true`, context isolation, no Node integration, and web security. The renderer policy has `default-src 'none'`, custom-scheme script/connect/image allowances, and no HTTP(S). `bypassCSP` is absent. |
| GET/POST/non-2xx parity | **PASS (implemented), runtime pending** | Fake routes and renderer assertions preserve query/method/header/status/body and binary POST digest. M0 intentionally does not claim full M1 HTTP parity. |
| Response streaming | **PASS (implemented), runtime pending** | The proxy wraps the undici reader in a `ReadableStream`; the renderer uses `getReader()` and requires a 750 ms first-byte lead without a whole-body helper on the stream route. |
| Cancellation | **PASS (implemented), runtime pending** | The proxy has once-only reader cancellation and finalization; the renderer aborts after one chunk and requires one response cancellation, signal abort, one upstream close, stable chunks, and zero proxy work. The Node unit test manually calls `reader.cancel`, so only the Electron run can prove automatic protocol cancellation. |
| Streamed upload | **PASS (implemented), runtime pending** | Three 256 KiB renderer chunks, 275 ms spacing, `duplex: 'half'`, upstream chunk/timing checks, and no concatenation fallback are present. |
| Multipart | **PASS (implemented), runtime pending** | Boundary, UTF-8 field, filename, binary sentinel, and byte count are checked. |
| Binary/RSS | **PASS (algorithm), artifact contract FAIL, runtime pending** | A single deterministic 256 KiB upstream buffer is streamed; the renderer retains only count/checksum; Main samples every 25 ms; Linux/Windows enforce `<48 MiB` at 64 MiB and `64 MiB delta +16 MiB` at 128 MiB. B1 means raw result evidence is not independently validated, and no real measurements exist. |
| Image/PDF/modules/plugin | **PASS (implemented), runtime pending** | PNG, structurally valid one-page PDF signature/length/digest, toy module, built system-info `web.mjs`, known dependency rewriting, registry wrappers, activation checks, and custom-scheme hit accounting exist under the representative CSP. Unknown bare plugin imports fail preparation. |
| Cleanup | **PASS (implementation), launcher FAIL** | Main checks proxy/upstream active counts, unhandles the protocol, closes the Agent and fake server, and writes only after cleanup. B2 leaves outer process cleanup unbounded. |
| Result atomics/artifact path | **PARTIAL / FAIL** | Main uses sibling write/rename and the runner removes the exact stale result and selects deterministic platform executables. B1 permits malformed evidence; B2 breaks bounded timeout behavior. |
| Packaging | **PASS (static), runtime pending** | Fixture builder uses `asar: true`, `npmRebuild: false`, fixture Main metadata, `release/m0`, prepared `resources/m0`, and no product hooks/resources/entitlements. Package scripts match Exploration A, and product `pack` appends packaged M0. Exact artifact launch has not run. |
| Linux CI | **PASS (static), runtime pending** | A required Ubuntu job installs Xvfb/Chromium dependencies and runs the combined gate without `continue-on-error`; compact evidence uploads on failure. No run result exists. |
| Windows package/release CI | **PASS (static), runtime pending** | The package workflow has relevant PR paths and exact-ref manual dispatch, runs packaged M0 before product E2E, and uploads M0 evidence. Windows release runs packaged M0 before publishing work, with no `continue-on-error`. No run result exists. |
| macOS | **Non-blocking pending** | Exploration A calls a manual/non-blocking arm64 run desirable but not M0 Done-minimum. No macOS M0 workflow was added. |
| Production Server/auth/WS/RSS/socket invariants | **UNCHANGED / out of Node A** | Node A does not alter Elysia/auth/ticket behavior, renderer bearer exposure, native PTY/`/sync`, or production sockets. It therefore neither violates nor proves later M1-M7 invariants. The 20-Tearoff/socket-ownership proof remains Node G, not M0. |

## Non-blocking findings

### N1. The “exact authority” unit-test claim is broader than the test

`proxy-handler.test.ts:33-43` verifies `local` success and a `remote` host rejection only. Current implementation also rejects port and credentials, but there is no focused regression test for those cases. Add explicit port, username/password, and malformed-authority cases when fixing the gate. This is not independently blocking because the source check is correct and the packaged runtime assertion list does not separately name authority rejection.

### N2. Exact privilege evidence is duplicated rather than mechanically coupled

The privileges passed to `registerSchemesAsPrivileged` in `main.ts` and the `M0_SCHEME_PRIVILEGES` evidence object in `result-contract.mjs` are separate literals. `scheme.privileges.exact` is then set true by Main based on source intent, because Electron exposes no privilege introspection. Current source is correct, but future drift could make the result claim exact privileges while registration differs. A shared locked registration descriptor plus a focused exact-object test would make the CI ratchet durable.

### N3. macOS diagnostic coverage is still absent

The plan permits macOS to remain non-blocking for M0 minimum acceptance, so this does not fail Node A. A manual/non-blocking arm64 packaged run remains desirable before promoting the gate across all release platforms, particularly for plugin/module loading and macOS memory diagnostics.

## Verification performed by this review

Passed from repository root:

- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json`
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --no-cache`
- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — 2 files, 5 tests passed
- `PNPM_HOME=/tmp/cradle-m0-pnpm XDG_DATA_HOME=/tmp/cradle-m0-xdg XDG_CACHE_HOME=/tmp/cradle-m0-cache pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts`
- YAML parsing of `.github/workflows/ci.yml`, `.github/workflows/verify-windows-desktop-package.yml`, and `.github/workflows/release-desktop.yml`
- fixture builder configuration import/inspection (`asar`, `npmRebuild`, Main metadata, files/resources, output)
- static source/bundle isolation search
- PDF object/xref offset check
- `git diff --check`

Reviewer reproduction of B1:

- Directly passed `validateM0Result()` a nominal result containing all 25 `passed: true` assertions but empty `memory`, `counters`, and `launch` objects; validation returned `ok: true`.

Unavailable or environment-blocked:

- Exact `pnpm --filter @cradle/desktop m0:custom-scheme:build` re-run triggered this managed worktree's pnpm dependency-status repair and failed before the package script at `mkdir '/root/.local'`. This is an environment limitation, not classified as a new implementation defect; the direct TypeScript/lint/tests and lockfile check above passed.
- Development Electron, packaged Electron, `pnpm build:desktop`, product `pack`, Linux RSS evidence, and Windows workflow execution were not available. No local or remote runtime result was inferred from static/bundle evidence.

## Architecture escalation and STOP decision

No Plan 063 architecture STOP condition has been demonstrated. The fixture does not broaden privileges or sessions, add HTTP fallback/buffering/private framing, change Chat/database/ticket semantics, or produce a failed Linux/Windows Electron assertion. The existing local launch failure occurred during dependency preparation before Electron and is not evidence that the custom scheme failed.

The required action is therefore:

- **STOP progression to Node C now** because M0 is unaccepted.
- Fix B1 and B2, rerun focused checks, then obtain both required Linux and Windows runtime artifacts.
- If a corrected runtime gate produces a Plan 063 STOP result—packaged-only failure, missing cancellation/upstream close, prohibited privilege/session/fallback need, `>=64 MiB` per-process growth, or persistent linear 128 MiB growth—preserve its JSON/logs and escalate to the separate local HTTP/2-over-TLS Plan B decision. Do not patch around it.

## Review quality checklist

- [x] Read Plan 063, the living ExecPlan, Exploration A, Implementation A, applicable repository instructions, and the complete Node A source/diff directly.
- [x] Checked the exact 25 required assertions and the security, streaming, cancellation, upload, multipart, RSS, subresource, session, cleanup, package, and CI invariants.
- [x] Distinguished current source correctness from unit/static evidence and from mandatory Electron runtime evidence.
- [x] Reproduced focused validation independently and recorded exact commands/results without upgrading bundle evidence into runtime evidence.
- [x] Identified blocking implementation defects separately from non-blocking test/ratchet findings.
- [x] Identified missing runtime evidence separately from code defects.
- [x] Checked locked-architecture exclusions and made an explicit architecture escalation/STOP determination.
- [x] Preserved unrelated worktree state and made no implementation fix.
- [x] Issued an explicit **FAIL** verdict and stated the condition for re-review.
