# Review G: M0 evidence-preservation-only correction

**Review role:** Independent Review Agent G; review only, no implementation or code modification
**Review date:** 2026-08-13
**Disposition:** **FAIL — one actionable diagnostic-redaction blocker.** The evidence-preservation correction is not code-ready because lifecycle checkpoints can retain a complete URL query string. This is a review of local code and evidence behavior only. It is **not** a development runtime PASS, packaged runtime PASS, Windows runtime PASS, or M0 acceptance. The known Linux behavior failures and Windows no-result runtime failure remain blocking.

## Scope and evidence boundary

I reviewed the living ExecPlan, Windows Exploration D, Linux Exploration E, Implementation F, current worktree diff, the complete M0 fixture directory, and the three affected workflows. I did not modify implementation, workflows, plans, production routing, tests, or the unrelated untracked `apps/server/src/http/websocket-ticket.ts`. The only file written by this review is this handoff.

The review checked orchestration/evidence preservation independently from M0 behavior. Local unit, type, lint, resource-preparation, and bundle success can establish code readiness but cannot prove Electron custom-scheme behavior on Linux or Windows. No external runtime was awaited or inferred.

## Actionable finding

### Blocker: lifecycle diagnostic redaction preserves complete query-bearing URLs

`apps/desktop/src/main/desktop-server-transport/fixtures/m0/diagnostic-envelope.mjs:5-12` redacts bearer text and a short list of secret-shaped assignments, but it does not remove URL query strings. A direct adversarial probe returned its input unchanged:

    redactDiagnosticText('navigation failed at https://example.test/path?alpha=one&beta=two')
    => 'navigation failed at https://example.test/path?alpha=one&beta=two'

This is reachable from the newly persisted Main lifecycle evidence. `main.ts:72-76` copies arbitrary `Error.message`; `main.ts:438`, `main.ts:454`, `main.ts:459`, and `main.ts:464` send it to navigation-failed, uncaught-exception, unhandled-rejection, and top-level-fatal checkpoints. Finalize and partition-probe failure paths use the same helper. `lifecycle-diagnostics.ts` applies `redactDiagnosticText` and then writes those strings to the uploaded JSONL file. Although the separately recorded `url` field correctly passes through `diagnosticUrl()` and drops search/hash, the adjacent `errorMessage` can still contain Electron's or Node's complete query-bearing URL.

The existing redaction test covers bearer/token/cookie/password assignments only; it does not cover URLs, fragments, URL-encoded credential names, or the lifecycle recorder's fatal/navigation shapes. Therefore the passing test suite does not close this acceptance condition.

Required correction: sanitize every diagnostic string so any parsed or embedded URL is reduced to an approved queryless form (and fragment removed) before persistence, while retaining the existing credential redaction. Add focused tests that pass query-bearing URLs through both `serializeDiagnosticError` and `createM0LifecycleRecorder`, including navigation and fatal checkpoint-shaped details, and assert the query values and full original URL are absent. Do not remove the checkpoints or weaken fail-closed evidence behavior.

## Acceptance criteria disposition

### Workflow behavior and evidence retention — PASS locally

- `.github/workflows/ci.yml` has separate development and packaged steps. The packaged step uses `if: always()` and neither runtime step uses `continue-on-error`; development failure therefore does not suppress packaged execution and either runtime failure remains a hard job failure.
- The Linux uploader runs on `always()`, includes hidden files, and uses `if-no-files-found: error`.
- The Windows verification uploader runs on `always()` and includes hidden `.m0-results`. The release workflow adds a dedicated always-run M0 uploader with hidden-file inclusion and `if-no-files-found: error` immediately after its packaged gate.
- Focused workflow tests lock these local YAML properties. This does not prove how a future hosted run will behave, but no contrary workflow condition was found.

### Runner envelope, missing-result behavior, and Windows evidence — PASS locally, runtime unverified

- `run-m0.mjs` atomically writes the diagnostic envelope through a sibling temporary file and rename before the fixture spawn and again in `finally` after settlement.
- The envelope records bounded metadata rather than environment values. It captures direct PID/outcome/timing, stdout/stderr byte counts and file evidence, result/lifecycle existence, artifact/app.asar metadata and hashes, and CI identity.
- A code-zero process with no result JSON produces an explicit `process exited without result JSON` error naming the diagnostic and lifecycle paths. Missing/empty lifecycle evidence is also an explicit failure. Nonzero, signal, and timeout outcomes remain hard failures pointing to the envelope.
- Windows inventory is limited to the exact fixture executable name, a 5-second command timeout, and 16 KiB per output stream. No claim is made that this local Linux review exercised Windows `tasklist` or resolved the prior relaunch/early-exit cause.
- Existing process-runner timeout and descendant-cleanup behavior was not changed beyond adding metadata, and its adversarial tests still pass.

### Main checkpoint ordering and behavior invariants — FAIL only on diagnostic confidentiality

- The earliest lifecycle recorder and `main.module-evaluated` checkpoint are created before `protocol.registerSchemesAsPrivileged`, while privileged registration still occurs synchronously at module scope before `main()` and `app.whenReady()`. The added recording does not move registration past Electron readiness.
- Ready, upstream, default-session handler, BrowserWindow, navigation, renderer, child-process, completion, settle, cleanup, temporary-write, atomic-rename, finalization, uncaught, rejection, and fatal boundaries are observable.
- BrowserWindow truth conditions remain `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`; the handler remains default-session-only and the partition probe remains a denial requirement.
- Fatal handlers still exit nonzero, and result writing still uses temporary write plus atomic rename.
- Token/cookie/bearer-shaped strings are covered by current redaction tests, but full query-bearing URLs are not redacted as described in the blocker. Consequently this section is FAIL overall.

### Frozen M0 truth conditions and production routing — PASS by diff inspection

Targeted worktree diff inspection found no changes to `result-contract.mjs`, `result-schema.ts`, `proxy-handler.ts`, renderer source/HTML, preload, fixture builder/Vite configuration, or production Desktop/Web/Server routing and auth files. Therefore the following remain unchanged in this correction:

- proxy and renderer assertions and evidence invariants;
- exact 48 MiB per-process 64 MiB delta thresholds and 16 MiB 64-to-128 MiB non-linear bounds;
- cancellation counters and active-request cleanup requirements;
- strict CSP and no-`bypassCSP` condition;
- exact scheme privilege contract;
- default-session handling and persistent-partition denial;
- BrowserWindow security preferences;
- real-plugin/dependency custom-scheme hit requirements;
- production renderer routing, Server auth/ticket behavior, and credential ownership.

No failed runtime assertion was skipped, weakened, recalibrated, or reclassified by this evidence-only diff.

## Verification performed

All commands ran from the repository root unless noted.

- Focused fixture tests: `node node_modules/vitest/vitest.mjs run apps/desktop/src/main/desktop-server-transport/fixtures/m0 --maxWorkers=1` — **PASS, 7 files / 21 tests**.
- Desktop Node typecheck: `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.node.json` — **PASS**.
- Fixture lint: `node node_modules/eslint/bin/eslint.js apps/desktop/src/main/desktop-server-transport/fixtures/m0 --max-warnings=0` — **PASS**.
- Real plugin preparation: `node apps/desktop/src/main/desktop-server-transport/fixtures/m0/prepare-real-plugin.mjs` — **PASS**, three shared dependencies prepared.
- Isolated bundle, from `apps/desktop`: `NODE_PATH=<repo>/apps/desktop/node_modules node node_modules/electron-vite/bin/electron-vite.js build --config src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts` — **PASS**, Main/preload/renderer/partition bundles emitted.
- Syntax checks for `run-m0.mjs`, `command-runner.mjs`, and `diagnostic-envelope.mjs` — **PASS**.
- `git diff --check` — **PASS**.
- Targeted behavior-contract/production-routing diff — **clean**.
- Adversarial URL-redaction probe — **FAIL**, complete query-bearing URL retained; this is the review blocker.

The generated bundle/resource outputs did not add tracked worktree changes. Current unrelated worktree state remains visible, especially the pre-existing untracked `apps/server/src/http/websocket-ticket.ts`; this review neither attributes nor modifies it.

## Final verdict and uncertainties

**Code/evidence-preservation verdict: FAIL.** Correct the diagnostic URL redaction and add the missing confidentiality tests, then re-review this narrow area. The remaining orchestration, atomic envelope, explicit missing-evidence, bounded process inventory, frozen truth-condition, and local verification requirements passed this review.

**Runtime verdict: FAIL / not accepted, unchanged from prior evidence.** There is no valid development-plus-packaged M0 pass in this review. Linux cancellation/RSS/real-plugin failures remain real failed evidence until an evidence-preserved run attributes them. Windows packaged still has no accepted result. Production routing must remain unchanged and downstream custom-scheme migration must remain blocked.

Uncertainties are deliberately bounded: this Linux Work container did not exercise Electron under Xvfb, an ASAR-packaged executable at runtime, Windows `tasklist`, Windows relaunch behavior, GitHub artifact upload, or any M0 behavior assertion. The review establishes local code properties only.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** scope, prior runtime status, reviewed paths, finding, acceptance disposition, commands/results, uncertainty, and next action are stated here.
- [x] **Tradeoffs and uncertainties explicit:** local code readiness is separated from Linux/Windows runtime acceptance; the single confidentiality blocker and unexercised platform behavior are explicit.
- [x] **Acceptance criteria addressed:** Linux hard-gate sequencing, hidden evidence, fail-closed missing evidence, atomic envelopes, bounded Windows evidence, checkpoint timing, confidentiality, frozen assertions/thresholds/CSP/session/privilege/BrowserWindow truth conditions, production routing, and every requested local validation are dispositioned.
- [x] **No implementation details leaked outside assigned scope:** this review changes no implementation, workflow, plan, production source, test, routing, or unrelated file and writes only this assigned Review G handoff.
- [x] **Human-review quality, honest/thorough/no marketing:** the report gives an explicit FAIL, supplies a reproducible blocker, does not convert passing local checks into runtime acceptance, and keeps production migration blocked.
