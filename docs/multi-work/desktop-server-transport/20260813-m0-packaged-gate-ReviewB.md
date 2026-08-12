# Review B: Plan 063 Node A packaged custom-scheme feasibility gate

**Review date:** 2026-08-13
**Reviewed scope:** Plan 063 M0 / ExecPlan Node A fixes after Review A
**Code-readiness verdict:** **FAIL**
**Runtime M0 acceptance:** **NOT EVALUATED / still pending**

Node A is not code-ready to publish as the M0 gate. B1, N1, and N2 are genuinely resolved, but B2 is only partially resolved: the launcher has a bounded TERM-to-KILL path while its direct child remains alive, yet it cancels that path as soon as the direct child exits. A signal-ignoring descendant can therefore survive the advertised timeout. This is a remaining code defect, not missing runtime evidence.

The mandatory development and ASAR-packaged Linux/Windows Electron artifacts are also still absent. That evidence remains a separate acceptance blocker after the launcher defect is fixed. Do not accept M0 or begin Node C.

## Sources and scope reviewed

I read the complete source documents directly:

- `plans/063-eliminate-desktop-server-sockets.md`
- `docs/exec-plans/20260813-01-desktop-server-transport.md`
- `docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-ImplementationA.md`
- `docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-ReviewA.md`
- `docs/multi-work/desktop-server-transport/20260813-m0-packaged-gate-FixA.md`
- root `AGENTS.md`, `apps/server/AGENTS.md`, `e2e/AGENTS.md`, the installed ExecPlan skill, and its complete `references/PLANS.md`

I also inspected the current worktree status and actual Node A source, including every file named by Fix A, the complete fixture boundary, Desktop package/lockfile changes, all three modified workflows, the isolated electron-vite/electron-builder configuration, and the generated fixture bundle. There is no Desktop-local `AGENTS.md`. The unrelated untracked `apps/server/src/http/websocket-ticket.ts` remains untouched.

## Review A finding disposition

| Finding | Re-review status | Evidence |
| --- | --- | --- |
| B1 result validator accepts malformed evidence | **RESOLVED** | The validator now enforces exact top-level, assertion, privilege, memory, counter, and launch fields; exact 25-name assertions; non-empty primitive details; finite/non-negative numeric evidence; non-empty time-ordered raw traces; baseline/peak/raw consistency; counter/detail agreement; and Linux/Windows RSS bounds. The Review A empty-object reproduction now fails with 59 validation errors. |
| B2 timeout does not bound process-tree cleanup | **NOT RESOLVED** | TERM-to-KILL escalation exists, but `child.once('exit')` calls `settle()`, and `settle()` clears the pending termination and force-settlement timers. A direct child that exits on group `SIGTERM` while its descendant ignores that signal causes early settlement and leaves the descendant alive. Independent reproduction confirmed this. |
| N1 exact-authority regression coverage | **RESOLVED** | The focused test covers another host, port, username, username/password, empty host, and trailing-dot host; every case returns 400 and increments the rejection counter. Exact `cradle-server://local` success remains covered. |
| N2 privilege evidence can drift from registration | **RESOLVED** | `M0_SCHEME_REGISTRATION` is the single frozen enabled-privilege descriptor. `main.ts` passes it directly to `registerSchemesAsPrivileged`, and `M0_SCHEME_PRIVILEGES` derives its enabled values from it. The focused test locks the exact object. |

## Remaining code defect

### B2-R1. POSIX timeout settlement still permits an orphaned descendant

`apps/desktop/src/main/desktop-server-transport/fixtures/m0/command-runner.mjs` starts the direct child as a POSIX process-group leader. At timeout it sends `SIGTERM` to that group and schedules `SIGKILL` after the grace period. However, the direct child's `exit` event immediately calls `settle()`, which clears the escalation timers.

That ordering fails the process-tree requirement when the direct child honors `SIGTERM` but a descendant does not. The direct child exits, the promise resolves, and the descendant remains alive because the scheduled group `SIGKILL` was canceled. This is especially relevant to an `electron-vite` launcher that can exit before a spawned Electron descendant.

The independent probe used a direct Node child that spawned a same-group descendant with a `SIGTERM` handler. With a 400 ms timeout, 150 ms grace, and 150 ms force-settlement interval, the observed result was:

    {
      "elapsedMs": 606,
      "outcome": {
        "code": null,
        "signal": "SIGTERM",
        "timedOut": true
      },
      "descendantAlive": true
    }

The review probe explicitly sent `SIGKILL` to the surviving descendant after recording the result. No test process was intentionally left running.

The existing test does not catch this because its direct child itself ignores `SIGTERM`, so the direct child remains alive long enough for the escalation timer to fire. B2 requires a regression test in which the parent exits on TERM while a descendant ignores TERM, and the runner must retain process-group cleanup ownership until the bounded cleanup sequence completes rather than canceling it on the direct child's exit.

## B1 result-contract verification

B1 is genuinely fixed for the Review A contract. In current source:

- result, privilege, assertion, memory-pair, trace, counter, and launch keys are exact;
- mode, platform, architecture, artifact path, schema version, and Electron `42.4.1` are checked against launcher facts;
- all 25 named assertions must exist, pass, and carry non-empty primitive detail records;
- raw samples must be non-empty, finite, non-negative integers, and time-ordered;
- raw first samples and maxima must agree with recorded trace baseline/peak values and memory summaries;
- required cancellation/session/module/cleanup counters have exact numeric invariants;
- named detail records are cross-checked against counters and recomputed memory deltas;
- Linux/Windows raw 64 MiB and 128 MiB bounds are recomputed by the validator.

An independent repetition of Review A's malformed-evidence probe supplied all 25 assertions as passing but used empty `memory`, `counters`, and `launch` objects and empty assertion details. `validateM0Result()` returned `ok: false` with 59 errors. The focused tests also reject missing/extra assertions, Electron drift, raw-trace contradictions, and counter contradictions.

## Mandatory runtime evidence remains missing

This section is deliberately separate from the code defect above.

The worktree contains only the earlier development preparation stdout/stderr logs. There is no successful development result JSON, no packaged result JSON, and no `apps/desktop/release/m0` artifact. The logs show dependency installation failed before Electron launched, so they are not custom-scheme runtime evidence.

Still required after B2 is fixed and re-reviewed:

1. Linux x64 CI must run `xvfb-run -a pnpm --filter @cradle/desktop m0:custom-scheme:gate` and retain valid development and packaged JSON, logs, raw 25 ms memory traces, exact artifact path, Electron version, cancellation/session counters, and workflow URL.
2. Windows x64 must run `pnpm --filter @cradle/desktop m0:custom-scheme:packaged` at the exact feature SHA and retain valid JSON for `release/m0/win-unpacked/cradle-m0-gate.exe`, logs, builder config, memory/cancellation/session evidence, and workflow URL.
3. `pnpm build:desktop` and `pnpm --filter @cradle/desktop pack` must pass, with product `pack` proving its appended packaged-M0 ratchet.
4. Plan 063 and the living ExecPlan must record the exact accepted measurements and workflow URLs before Node C begins.

No development or packaged Electron assertion, RSS threshold, cancellation behavior, partition isolation behavior, plugin/CSP behavior, or cleanup behavior is inferred from unit, static, configuration, or bundle evidence.

## Requirement and invariant review

| Area | Re-review status | Evidence and limit |
| --- | --- | --- |
| Fixture isolation and production routing | **PASS (static)** | Fixes remain inside the fixture boundary; package/workflow integration is unchanged. No production Main/Web/Server route uses the custom scheme. |
| Locked architecture | **PASS (static)** | The fixture still uses the custom scheme, a fixture-owned undici Agent, and loopback `node:http`; it adds no private Request/Response framing, renderer HTTP fallback, PTY IPC, Server `app.handle`, database change, or Chat semantic change. |
| Exact result evidence / B1 | **PASS** | Validator and tests enforce the reviewed nested evidence contract and internal RSS/counter consistency. |
| Bounded launcher / B2 | **FAIL** | Direct-child timeout is bounded, but a descendant can survive if the direct child exits before escalation. |
| Exact authority / N1 | **PASS** | Exact success plus host, port, credential, empty-host, and trailing-dot rejection are tested. |
| Scheme privilege coupling / N2 | **PASS** | One locked descriptor owns registration and enabled result evidence; no second enabled-privilege literal remains in Main. |
| Scheme/session/CSP/streaming/upload/RSS/subresources/cleanup | **PASS as implementation/static where previously reviewed; runtime pending** | The fixes do not introduce a new defect in these paths, but no Electron runtime claim is accepted. |
| Linux/Windows CI and packaging configuration | **PASS (static), runtime pending** | Workflow YAML and isolated builder configuration parse and retain the required commands/configuration. No successful run exists. |
| macOS | **Non-blocking pending** | Still outside the M0 minimum acceptance platforms described by the plan. |

## Focused verification performed by this re-review

Passed from the repository root:

- `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — 3 files, 9 tests passed.
- `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — exit 0.
- `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --no-cache --max-warnings=0` — exit 0 with no warnings.
- Direct malformed-result reproduction — correctly rejected with 59 validation errors.
- YAML parsing for `.github/workflows/ci.yml`, `.github/workflows/verify-windows-desktop-package.yml`, and `.github/workflows/release-desktop.yml` — pass.
- Isolated builder configuration inspection (`asar`, `npmRebuild`, fixture Main, output) — pass.
- `git diff --check` and fixture trailing-whitespace scan — pass.

Passed from `apps/desktop`:

- `NODE_PATH=/workspace/scratch/bcdefa6cb3a5/cradle-app/apps/desktop/node_modules node node_modules/electron-vite/bin/electron-vite.js build --config src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts` — isolated Main, preload, and renderer bundles built successfully.

Failed focused adversarial evidence:

- A timed-out direct child that spawned a signal-ignoring same-group descendant returned `timedOut: true` with direct-child signal `SIGTERM`, while the descendant remained alive. The probe cleaned up the descendant. This reproduces B2-R1 and is the basis for the code-readiness failure.

Unavailable and not inferred:

- Development Electron, ASAR-packaged Electron, Linux/Windows result JSON and RSS traces, `pnpm build:desktop`, product `pack`, and workflow runs/URLs.

## Architecture escalation and disposition

No Plan 063 architecture STOP condition has been demonstrated. B2-R1 is launcher orchestration, not evidence that the Electron custom-scheme architecture failed. There is still no runtime result that would justify Plan B.

The required disposition is:

- **FAIL code readiness to publish the M0 gate.** Fix B2-R1 and add the parent-exits/descendant-ignores regression test, then re-review the launcher.
- **Do not accept runtime M0.** After code readiness passes, obtain the mandatory Linux development/packaged and Windows packaged evidence.
- **Do not begin Node C or route production traffic through `cradle-server://local`.**
- If corrected runtime evidence later hits a Plan 063 STOP condition, preserve JSON/logs/measurements and escalate to the separate local HTTP/2-over-TLS Plan B decision without adding fallback, buffering, broader privileges/sessions, or private framing.

## Review quality checklist

- [x] Read Plan 063, the living ExecPlan, Implementation A, Review A, Fix A, applicable repository instructions, and the complete affected source/diff directly.
- [x] Verified B1, B2, N1, and N2 independently rather than relying on the fix handoff.
- [x] Repeated the Review A malformed-result probe and checked exact assertion, trace, counter, launch, platform, artifact, and RSS validation.
- [x] Reviewed the launcher timeout, termination, escalation, spawn-error, output, and settlement paths.
- [x] Added no implementation fix and modified no production source.
- [x] Ran focused tests, direct Desktop TypeScript, fixture lint, isolated bundle build, workflow/builder parsing, and diff hygiene.
- [x] Identified the remaining code defect separately from mandatory runtime evidence.
- [x] Did not promote bundle/static/unit evidence into Electron runtime evidence.
- [x] Checked locked-architecture exclusions and made an explicit architecture escalation/STOP determination.
- [x] Preserved unrelated worktree state, including the untracked Server file.
- [x] Issued an explicit **FAIL** for code readiness to publish the M0 gate, distinct from final runtime M0 acceptance.
