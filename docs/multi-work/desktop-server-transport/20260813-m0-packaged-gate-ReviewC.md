# Review C: Plan 063 Node A B2-R1 launcher re-review

**Review date:** 2026-08-13
**Reviewed scope:** Plan 063 M0 / ExecPlan Node A remaining Review B defect B2-R1 after Fix B
**Code-readiness verdict:** **PASS**
**Runtime M0 acceptance:** **NOT EVALUATED / still pending**

The remaining B2-R1 launcher defect is resolved. On POSIX, timeout cleanup now retains the captured process-group identifier after the direct child exits, delivers the scheduled group `SIGKILL` to a signal-ignoring descendant, and resolves only after the bounded TERM-to-KILL cleanup sequence. The required parent-exits/descendant-ignores regression passes, and an independent five-iteration reproduction found no live descendant at settlement.

Node A is code-ready to publish as the M0 gate. This verdict is intentionally separate from runtime M0 acceptance: the required Linux development and packaged Electron evidence and Windows packaged Electron evidence are still absent, so M0 is not accepted and Node C remains blocked.

## Sources and scope reviewed

I read these source documents directly:

- `docs/exec-plans/20260813-01-desktop-server-transport.md`
- `docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-ReviewB.md`
- `docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-FixB.md`
- root `AGENTS.md`
- `apps/server/AGENTS.md`, to confirm that the unrelated untracked Server file remains outside this fixture-only review

There is no Desktop-local `AGENTS.md`. I also inspected the current worktree status, the actual command runner, its declaration, its complete tests and call sites, the B1 result validator/tests, the N1 proxy authority implementation/tests, the N2 scheme registration/evidence descriptor/tests, and the fixture Main registration site. The entire M0 fixture directory is currently untracked, so ordinary `git diff` does not expose file-level Fix B deltas; this review therefore evaluated the current source directly and used Review B's precise failing behavior as the adversarial regression oracle. The unrelated untracked `apps/server/src/http/websocket-ticket.ts` remains untouched.

## Review B finding disposition

| Finding | Re-review status | Evidence |
| --- | --- | --- |
| B2-R1 parent exits while descendant ignores TERM | **RESOLVED** | `runCommand()` captures `child.pid` as the process-group identifier, retains timeout-owned settlement after direct-child exit, signals the captured POSIX group with `SIGKILL` after the grace period, and settles only after force cleanup. The new regression and an independent five-iteration probe both prove the descendant is gone at resolution. |
| B1 result validator accepts malformed evidence | **PRESERVED** | The complete fixture suite still passes the tests for exact result/assertion/privilege/memory/counter/launch shape, empty evidence rejection, version/missing/extra/contradictory evidence rejection, and cross-evidence invariants. The B2-R1 change does not touch the result contract. |
| N1 exact-authority regression coverage | **PRESERVED** | The proxy suite still proves exact `cradle-server://local` success and rejects another host, a port, username, username/password, an empty host, and a trailing-dot host, with rejection-counter agreement. |
| N2 privilege evidence can drift from registration | **PRESERVED** | `M0_SCHEME_REGISTRATION` remains the single enabled-privilege descriptor passed directly to `registerSchemesAsPrivileged`; `M0_SCHEME_PRIVILEGES` derives from it, and the exact descriptor test remains green. |

## B2-R1 code-path verification

The corrected runner has a distinct timeout-owned settlement path:

1. It captures `const processGroupId = child.pid` immediately after spawn. POSIX cleanup always targets `process.kill(-processGroupId, signal)`, so loss of the group leader does not discard group ownership.
2. At `timeoutMs`, it sets `timedOut = true` before sending group `SIGTERM` and scheduling escalation.
3. The direct child's `exit` listener records `{ code, signal }`, but calls `settle()` only when `timedOut` is false. A timeout-owned cleanup sequence therefore cannot be canceled by the parent's exit.
4. After `terminationGraceMs`, it sends group `SIGKILL` using the captured identifier even if the direct child's `exitCode` or `signalCode` is already set.
5. After `forceSettleMs`, it destroys the captured stdout/stderr pipes, unreferences the child handle, and resolves with the recorded direct-child outcome. `settle()` clears all timers and is idempotent.
6. Normal pre-timeout exit still settles immediately. Spawn error still clears timers, attempts force cleanup, releases handles, and rejects without waiting for the command timeout.

The new POSIX regression specifically distinguishes this fix from the old partial B2 coverage: the parent retains default TERM behavior and exits with `SIGTERM`, while its same-group descendant installs a TERM handler. The test requires `timedOut: true`, direct-parent `signal: 'SIGTERM'`, settlement under its 2-second cap, a valid descendant PID, and confirmed descendant exit before success. Its `finally` guard force-kills the descendant if a future assertion fails.

An independent probe repeated the same failure shape five times with `timeoutMs: 300`, `terminationGraceMs: 100`, and `forceSettleMs: 100`. All five outcomes recorded `timedOut: true`, direct-parent `SIGTERM`, and `descendantAliveAtResolution: false`. Observed settlement was 504, 638, 509, 504, and 504 ms; the nominal cleanup envelope was 500 ms plus ordinary event-loop scheduling, and every run was below the independent 1.5-second adversarial cap. A post-probe process search found no matching survivor.

## Requirement and invariant review

| Area | Re-review status | Evidence and limit |
| --- | --- | --- |
| Parent-exits/descendant-ignores cleanup | **PASS** | The group identifier outlives the direct child; scheduled group `SIGKILL` is not canceled; regression and repeated independent reproduction prove descendant death at settlement. |
| Bounded settlement | **PASS** | Timeout ownership deterministically reaches force settlement after timeout + grace + force-settle intervals; observed adversarial runs remained bounded, including when the direct parent exited before escalation. |
| Normal exit and spawn error | **PASS** | Pre-timeout exit still settles immediately; the ENOENT regression rejects in under its 2-second cap rather than waiting for the configured 5-second timeout. |
| Prior B1, N1, N2 fixes | **PASS** | Complete M0 fixture suite passes 10/10, including the exact result evidence, exact authority, and single privilege-descriptor tests. |
| Fixture isolation and production routing | **PASS (static)** | The correction is confined to the fixture runner/test boundary and changes no production Main, Web, Server, lifecycle, auth, ticket, session, database, or routing behavior. |
| Locked architecture | **PASS (static)** | No fallback, buffering workaround, broader privilege, BrowserPanel scheme registration, private Request/Response framing, or production transport change was introduced. |
| Electron custom-scheme behavior and RSS bounds | **RUNTIME PENDING** | Unit/static/type/lint/bundle evidence cannot prove development or packaged Electron behavior. |
| Linux/Windows packaged acceptance | **RUNTIME PENDING** | No accepted result JSON, executable run, RSS trace, cancellation/session evidence, or workflow URL was supplied by Fix B or produced by this re-review. |

## Focused validation performed

Passed from the repository root:

- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — 3 files, 10 tests passed.
- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — exit 0.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --no-cache --max-warnings=0` — exit 0 with no warnings.
- Independent five-iteration parent-exits/descendant-ignores probe — all descendants dead at resolution; all outcomes bounded and correctly reported as timed out with direct-parent `SIGTERM`.
- Post-probe survivor check — no matching process remained.
- `git diff --check` — exit 0.

Passed from `apps/desktop`:

- `NODE_PATH=/workspace/scratch/bcdefa6cb3a5/cradle-app/apps/desktop/node_modules node node_modules/electron-vite/bin/electron-vite.js build --config src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts` — isolated Main, preload, and renderer bundles built successfully.

The Vitest/Vite runs emitted only the existing informational `vite-tsconfig-paths` and `esbuild`/Oxc configuration notices. They produced no test, type, lint, or bundle failures.

## Runtime acceptance remains separate

This re-review did not launch Electron and does not promote unit, static, type, lint, or bundle evidence into runtime evidence. M0 still requires, at the exact feature revision:

1. Linux x64 development and ASAR-packaged runs with valid atomic JSON, logs, raw RSS traces, exact artifact path and Electron `42.4.1`, cancellation/session/cleanup counters, and workflow URL.
2. Windows x64 packaged execution with the same validated evidence for `release/m0/win-unpacked/cradle-m0-gate.exe`.
3. Successful `pnpm build:desktop` and `pnpm --filter @cradle/desktop pack`, including the product pack's packaged-M0 ratchet.
4. Accepted measurements and workflow URLs recorded in Plan 063 and the living ExecPlan before Node C begins.

Therefore the explicit dispositions are:

- **PASS code readiness to publish the Node A M0 gate.**
- **DO NOT accept runtime M0 yet.**
- **DO NOT begin Node C or route production traffic through `cradle-server://local` until mandatory runtime evidence passes and is recorded.**

## Architecture escalation and STOP determination

No Plan 063 architecture STOP condition was exercised or discovered by the B2-R1 correction. The defect was isolated launcher orchestration, and its fix does not weaken the locked custom-scheme architecture. There is no evidence supporting Plan B. If the future development or packaged runs hit a STOP condition, preserve their artifacts and measurements and escalate without adding renderer HTTP fallback, buffering, broader privileges or sessions, BrowserPanel access, ticket weakening, or private framing.

## Review quality checklist

- [x] Read the living ExecPlan, Review B, Fix B, applicable repository instructions, and actual runner/tests/call sites directly.
- [x] Inspected current worktree status and accounted for the fixture directory being untracked rather than assuming an ordinary diff contained it.
- [x] Reproduced the exact parent-exits/descendant-ignores failure shape independently of the committed regression.
- [x] Verified the captured process-group identifier remains usable after direct-parent exit.
- [x] Verified direct-child exit cannot cancel timeout-owned TERM-to-KILL escalation or settle early.
- [x] Verified deterministic force settlement remains bounded and idempotent.
- [x] Verified normal exit and spawn-error behavior remains covered.
- [x] Verified prior B1, N1, and N2 fixes through current source and focused tests.
- [x] Ran the complete M0 fixture suite, Desktop Node typecheck, fixture lint, isolated fixture bundle build, adversarial repeated probe, survivor check, and diff hygiene.
- [x] Added no implementation fix and modified no production source.
- [x] Preserved unrelated worktree state, including the untracked Server file.
- [x] Kept code readiness separate from mandatory Electron runtime acceptance.
- [x] Did not infer Electron scheme, cancellation, session, plugin/CSP, or RSS behavior from non-runtime evidence.
- [x] Checked locked-architecture exclusions and made an explicit architecture escalation/STOP determination.
- [x] Issued an explicit **PASS** for code readiness to publish the M0 gate and an explicit **NOT ACCEPTED** disposition for runtime M0.
