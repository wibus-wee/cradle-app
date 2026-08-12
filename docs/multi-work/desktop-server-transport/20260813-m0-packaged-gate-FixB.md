# Fix B handoff: Plan 063 Node A launcher cleanup

**Task node:** Plan 063 Node A / Review B defect B2-R1 only

**Fix date:** 2026-08-13

**Disposition:** B2-R1 is fixed in the fixture-only M0 command runner. A timed-out POSIX launcher now retains ownership of its process group after the direct child exits, completes the bounded TERM-to-KILL sequence, and settles only after that cleanup sequence. The parent-exits/descendant-ignores regression passes. This handoff does not accept M0, authorize Node C, or make any production-routing or Electron-runtime claim.

## Sources and scope

I read the complete root `AGENTS.md`, `docs/exec-plans/20260813-01-desktop-server-transport.md`, `docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-ReviewB.md`, and the actual M0 command runner, declaration, tests, and call sites directly. There is no Desktop-local `AGENTS.md`.

The implementation changes only:

- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/command-runner.mjs`
- `apps/desktop/src/main/desktop-server-transport/fixtures/m0/command-runner.test.ts`

This handoff is the only documentation addition. No production Main, Server, Web, lifecycle, credential, ticket, Chat, database, routing, packaging, or session behavior changed. The prior B1, N1, and N2 fixes remain intact. The unrelated untracked `apps/server/src/http/websocket-ticket.ts` and all other existing worktree changes remain untouched.

## B2-R1 resolution

The runner now captures the spawned child's process-group identifier immediately and keeps that identifier independently of the direct child's exit state. On POSIX, process-tree signaling targets the negative captured group identifier even after the group leader has exited. The direct child is used as a fallback target only while it is still alive and the group signal fails.

Timeout settlement now has a distinct lifecycle from ordinary child settlement:

1. At the configured timeout, the runner marks the outcome timed out and signals the owned process tree with `SIGTERM`.
2. A direct-child exit records its code and signal but does not clear timers or resolve the promise once timeout cleanup owns settlement.
3. After the configured termination grace period, the runner signals the captured process group with `SIGKILL`, including when the direct child has already exited.
4. After the configured force-settlement interval, the runner closes captured pipes, releases the child handle, and resolves with the recorded direct-child outcome when available.

This keeps the full cleanup path bounded by `timeoutMs + terminationGraceMs + forceSettleMs`, subject only to ordinary event-loop scheduling. Normal pre-timeout child exit still settles immediately, and spawn errors still clear timers, force cleanup, and reject without waiting for the command timeout.

## Regression coverage

The new POSIX regression launches a dedicated process-group leader that spawns a same-group descendant. The parent uses normal `SIGTERM` behavior and therefore exits at the first timeout signal; the descendant installs a `SIGTERM` handler and remains active unless the scheduled group `SIGKILL` occurs.

The test proves all of the Review B conditions:

- the command is reported as timed out;
- the direct-child outcome records `SIGTERM`, proving the parent exited before escalation;
- the runner settles within the configured bound;
- the descendant PID no longer exists when `runCommand()` resolves;
- a `finally` guard force-kills the descendant if a future regression causes the assertion path to fail, so the test does not intentionally leave an orphan.

The test is skipped on Windows because B2-R1 is specifically the POSIX process-group-leader exit defect. The pre-existing cross-platform timeout test continues to exercise bounded tree escalation when the direct child itself ignores termination.

## Focused validation

Passed from the repository root:

- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0/command-runner.test.ts --maxWorkers=1` — 1 file, 3 tests passed.
- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — 3 files, 10 tests passed.
- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — exit 0.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --no-cache --max-warnings=0` — exit 0 with no warnings.
- `git diff --check` — exit 0.

Passed from `apps/desktop`:

- `NODE_PATH=/workspace/scratch/bcdefa6cb3a5/cradle-app/apps/desktop/node_modules node node_modules/electron-vite/bin/electron-vite.js build --config src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts` — isolated Main, preload, and renderer bundles built successfully.

The Vitest/Vite runs emitted only the existing informational `vite-tsconfig-paths` and `esbuild`/Oxc configuration notices; they did not produce test, type, lint, or build failures.

## Runtime evidence and STOP status

No Electron application, development M0 gate, ASAR-packaged M0 gate, or Windows packaged workflow was run by this fix. There is no new result JSON, RSS trace, cancellation/session record, packaged executable result, or workflow URL. Unit, static, type, lint, and bundle evidence is not promoted to Electron runtime evidence.

No Plan 063 architecture STOP condition was exercised or discovered. Production routing remains unchanged. Node A still requires independent re-review plus the mandatory Linux development/packaged and Windows packaged evidence before M0 can be accepted or Node C can begin.

## Handoff quality checklist

- [x] Read the living ExecPlan, Review B, applicable repository instructions, and actual command-runner source/tests/call sites directly.
- [x] Limited implementation edits to the remaining B2-R1 defect inside the isolated M0 fixture boundary.
- [x] Retained the captured POSIX process-group identifier after direct-child exit.
- [x] Prevented direct-child exit from canceling timeout-owned cleanup or settling the timed-out command early.
- [x] Preserved bounded TERM-to-KILL escalation and deterministic forced settlement.
- [x] Added the required parent-exits/descendant-ignores regression test with defensive orphan cleanup.
- [x] Preserved the prior B1, B2 partial, N1, and N2 fixes and their focused test coverage.
- [x] Ran the focused command-runner and complete M0 fixture tests, Desktop typecheck, fixture lint, isolated bundle build, and diff hygiene successfully.
- [x] Left production routing and all later Plan 063 node semantics unchanged.
- [x] Preserved unrelated worktree state, including the untracked Server file.
- [x] Recorded that mandatory Electron runtime acceptance evidence remains missing and made no runtime claim.
- [x] Found no architecture escalation requiring a patch stop.
- [x] Formal output is this handoff file only.
