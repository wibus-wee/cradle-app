# Implementation F: M0 evidence-preservation-only correction

**Task:** Plan 063 / living ExecPlan Node A evidence preservation after incomplete Linux and Windows runtime evidence
**Implementation date:** 2026-08-13
**Disposition:** **IMPLEMENTED AND LOCALLY VERIFIED; NO M0 RUNTIME PASS.** This correction preserves the next development and packaged observations and makes a missing result an explicit evidence failure. It does not correct, weaken, skip, recalibrate, or reclassify any custom-scheme behavior assertion. Production routing remains blocked.

## Scope and evidence boundary

The Linux development run produced a real failed M0 result while the composite `development && packaged` command prevented the packaged run. Its hidden `.m0-results` files were not retained. The Windows packaged runs exited without a result JSON, and the upload path likewise excluded hidden evidence. Those observations establish orchestration and observability defects, not a custom-scheme architecture verdict.

This implementation changes only the isolated M0 fixture runner/Main diagnostics and relevant GitHub Actions evidence retention. It did not modify production routing, renderer transport ownership, Server auth, proxy behavior, the M0 result schema/validator, required assertion names, assertion truth conditions, RSS thresholds, scheme privileges, CSP, session ownership, BrowserWindow security preferences, or package scripts. The pre-existing untracked `apps/server/src/http/websocket-ticket.ts` remains untouched.

## Acceptance criteria disposition

### Linux development and packaged execution are independent hard gates

`.github/workflows/ci.yml` now runs development and packaged M0 in separate workflow steps. The development step runs `m0:custom-scheme:dev`. The packaged step has `if: always()` and runs `m0:custom-scheme:packaged`, so a development failure does not suppress the packaged observation. Neither run step uses `continue-on-error`; therefore either or both failures still fail the job. A focused workflow test locks the ordering, `if: always()`, distinct commands, and hard-failure semantics.

The existing package-level `m0:custom-scheme:gate` command remains unchanged. CI no longer relies on its `development && packaged` composition for the Linux evidence gate.

### Evidence is retained on success and failure, including hidden files

The Linux M0 uploader now has `if: always()`, `include-hidden-files: true`, and `if-no-files-found: error`. It retains `.m0-results/**` and the M0 builder effective config on success or failure. Missing evidence is itself a failing condition rather than a warning.

The Windows package workflow's always-run artifact uploader now has `include-hidden-files: true`, preserving its hidden `.m0-results/**` files alongside the existing product artifacts. Its broad `if-no-files-found: warn` remains appropriate because that upload combines several independently optional product paths; focused tests lock the always-run hidden-M0 behavior.

The Windows release job now has a dedicated always-run M0 evidence uploader immediately after the packaged gate. It has `include-hidden-files: true` and `if-no-files-found: error`, so an M0 failure before later release steps still retains, or explicitly fails to retain, its diagnostics.

### Runner diagnostic envelope and explicit missing-result failure

`run-m0.mjs` now writes an atomic, mode/platform-specific `*.diagnostic.json` envelope before fixture launch and rewrites it after process settlement. The pre-launch envelope records the runner identity, Node/platform/architecture, CI run identity when present, exact result/stdout/stderr/lifecycle/artifact paths, launch command and arguments, timeout, sandbox launch policy, environment-variable presence booleans, and packaged executable plus `app.asar` stat/SHA-256 evidence. It deliberately records presence rather than environment values.

The post-settlement envelope records the direct PID, code, signal, timeout state, start/settle timestamps, elapsed time, stdout/stderr byte counts and file metadata, result/lifecycle existence and metadata, and a bounded Windows `tasklist` inventory for the exact fixture executable name. Runner output metadata was added to `CommandOutcome` without changing timeout or process-tree cleanup behavior.

When a code-zero process has no result JSON, the runner now throws an explicit `process exited without result JSON` evidence error naming both the diagnostic envelope and lifecycle file. A missing or empty lifecycle file is also an explicit evidence error. The runner no longer reduces this boundary to a bare `readFile` `ENOENT`.

The envelope writer uses sibling temporary files and atomic rename. Diagnostic errors and lifecycle string details redact bearer and secret-shaped assignments. The runner records no environment secrets, bearer values, cookies, passwords, or tokens.

### Earliest Main, renderer, navigation, fatal, and finalize checkpoints

Fixture Main writes an append-only `*.lifecycle.jsonl` record beginning at module evaluation, followed by the unchanged privileged scheme registration. Subsequent checkpoints cover Main start and `app.whenReady()`, packaged identity (`app.isPackaged`, executable/app/resource paths, Electron version, mode and result path), fake-upstream start/readiness, default-session protocol handler installation, BrowserWindow creation and its unchanged security settings, navigation start/completion/failure, renderer load completion/failure, renderer gone/unresponsive/responsive, child process gone, renderer completion IPC, partition probe, five-second settle, window/protocol cleanup, Agent/upstream cleanup, temporary result write, atomic result rename, finalize outcome, fatal finalize, top-level fatal, uncaught exception, and unhandled rejection.

This sequence distinguishes the first missing Windows boundary without assuming a GUI, package, process-lifecycle, renderer, or custom-scheme cause. Lifecycle values pass through diagnostic redaction and contain no credential values.

### Custom-scheme behavior remains unchanged

The behavior-contract diff check was clean for `result-contract.mjs`, `result-schema.ts`, `proxy-handler.ts`, renderer source/HTML, preload, fixture builder/Vite configs, and all production routing files. The result validator still requires the same exact assertion set and evidence invariants. The 48 MiB and 16 MiB RSS limits, cancellation counters, module-hit minimum, strict CSP, exact five enabled/four disabled privileges, default-session-only handler, partition denial, sandboxed/context-isolated BrowserWindows, and cleanup truth conditions are unchanged.

No runtime result was generated in this Work container and no failed assertion was reclassified. The known Linux behavior failures remain failures. The repeated Windows no-result outcome remains a runtime failure. **There is no development runtime PASS, no packaged runtime PASS, and no M0 acceptance claim in this handoff.**

## Focused tests added

`diagnostic-envelope.test.ts` proves atomic JSON evidence writing, exact artifact SHA-256 metadata, and secret-shaped error redaction. `lifecycle-diagnostics.test.ts` proves ordered, self-contained JSONL checkpoints and redaction. `evidence-workflows.test.ts` locks independent Linux hard-gate steps, packaged execution after development failure, always-run uploads, hidden-file inclusion, and strict missing-evidence handling for the dedicated uploaders. `command-runner.test.ts` now also locks PID and process timing evidence while retaining the existing timeout/process-tree adversarial coverage.

## Validation performed

All commands ran from the repository root unless a working directory is stated.

- Fixture tests: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` passed **7 files / 21 tests**.
- Desktop Node typecheck: `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` passed with no diagnostics.
- Fixture lint: `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` passed with no diagnostics.
- Fixture resource preparation: `node apps/desktop/src/main/desktop-server-transport/fixtures/m0/prepare-real-plugin.mjs` passed and reported three prepared shared dependencies.
- Isolated fixture bundle: from `apps/desktop`, `NODE_PATH=<repository>/apps/desktop/node_modules node node_modules/electron-vite/bin/electron-vite.js build --config src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts` passed and emitted Main, preload, renderer, partition, and real-plugin-resource bundles under `apps/desktop/dist/m0/`.
- Syntax checks: direct `node --check` passed for `run-m0.mjs`, `command-runner.mjs`, and `diagnostic-envelope.mjs`.
- Diff hygiene: `git diff --check` passed. Targeted diff checks reported `behavior-contract-diff: clean` and `production-routing-and-forbidden-file-diff: clean`.

The repository's pnpm wrapper first attempted to initialize an unavailable `/root/.local` store, and the first direct electron-vite invocation lacked dependency resolution from the partial linked store. The validation therefore used the already-installed direct Node entry points and an explicit non-secret `NODE_PATH` for the isolated bundle. This is an environment constraint, not a runtime PASS or a reason to weaken M0.

## Files changed by Implementation F

Workflow changes are limited to `.github/workflows/ci.yml`, `.github/workflows/verify-windows-desktop-package.yml`, and `.github/workflows/release-desktop.yml`.

Fixture changes are limited to `apps/desktop/src/main/desktop-server-transport/fixtures/m0/command-runner.{mjs,d.mts}`, `command-runner.test.ts`, `run-m0.mjs`, `main.ts`, and the new diagnostic/lifecycle/workflow focused-test modules in that same fixture directory.

No commit was created and nothing was pushed.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** the prior evidence gap, implementation boundary, exact corrections, acceptance disposition, verification commands/results, runtime status, and remaining STOP are all stated here.
- [x] **Tradeoffs and uncertainties explicit:** workflow evidence defects are separated from unresolved Linux behavior and Windows lifecycle failures; direct-tool validation constraints and the absence of runtime evidence are explicit.
- [x] **Acceptance criteria addressed:** independent Linux hard gates, always-run hidden evidence uploads, runner envelopes, explicit missing-result errors, Main lifecycle/fatal/renderer/navigation/finalize checkpoints, unchanged behavior truth conditions, focused tests, and all required local checks are dispositioned individually.
- [x] **No implementation details leaked outside assigned scope:** changes are confined to M0 evidence collection and related workflows; production routing, auth, Server code, package scripts, and the forbidden untracked file are untouched.
- [x] **Human-review quality, honest/thorough/no marketing:** this handoff makes no runtime PASS claim, preserves all known failures, names the exact local evidence and constraints, and keeps Plan 063 production migration blocked pending valid development and packaged runtime results.
