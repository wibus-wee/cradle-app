# Exploration D: M0 Windows packaged runtime exits without a result

**Task node:** Plan 063 / living ExecPlan Node A, first Windows x64 packaged execution

**Exploration date:** 2026-08-13

**Disposition:** **STOP. Windows packaged M0 has failed and is not accepted.** Run [31622852684, job 94201752466](https://github.com/wibus-wee/cradle-app/actions/runs/31622852684/job/94201752466) built the Windows x64 unpacked fixture and launched its executable, but produced no `packaged-win32-x64.json`. The available evidence ends at the direct executable returning code 0; it does not show that fixture Main reached `app.whenReady()`, installed the handler, created a renderer, received `m0:complete`, or wrote its result. Consequently this run proves none of the custom-scheme, cancellation, CSP/plugin, partition-isolation, or RSS acceptance assertions.

The immediate defect is an observability failure around an early packaged-process exit. A functional Electron fix cannot yet be selected honestly. The minimum next correction is to preserve runner and earliest-Main lifecycle evidence, include the dot-directory in artifact upload, and distinguish direct-process exit from a surviving/relaunched Windows process. Only the resulting first-missing checkpoint should drive a startup, package, GUI, or process-lifecycle fix.

## Evidence boundary

I read the repository `AGENTS.md`, the living ExecPlan, packaged-gate Exploration A and Review C, the exact workflow, and the fixture runner/package/Main sources. Runtime conclusions below are anchored to PR #163 revision `dc3b24c3199cf2245f1f6ee8e628a30bd995c1bc`, not to later local fixture edits.

GitHub's Actions API proves the following for run `31622852684`, attempt 1:

- workflow `Verify Windows Desktop Package`, job `Package Windows Desktop`, ran on `windows-latest` and failed;
- checkout used head SHA `dc3b24c3199cf2245f1f6ee8e628a30bd995c1bc`;
- setup succeeded;
- `Run packaged M0 custom-scheme gate` ran from `17:30:54Z` to `17:31:58Z` and failed;
- every product build/package/e2e step after it was skipped;
- the always-run upload step completed but warned that none of its configured paths produced an upload;
- the check annotations contain only the final exit-code-1 annotation and the no-files upload warning; the run has zero retained artifacts.

The supplied step-level observation adds that electron-builder produced and signed `apps/desktop/release/m0/win-unpacked/cradle-m0-gate.exe`; its subsequent direct launch returned code 0 after roughly 13 seconds; the runner then failed reading `apps/desktop/.m0-results/packaged-win32-x64.json` with `ENOENT`.

The connected GitHub API did not return the archived job-log ZIP body. Therefore exact stdout/stderr lines beyond the supplied observation are unavailable here. This limitation matters because the workflow also failed to retain the runner's own log files.

## What the exact source does

At the tested revision, `m0:custom-scheme:packaged` performs these operations in order:

1. builds the real plugin resource and the isolated Electron main/preload/renderer bundles;
2. packages an ASAR `dir` target through the fixture electron-builder config into `release/m0/win-unpacked`;
3. invokes `run-m0.mjs --mode packaged`;
4. creates `apps/desktop/.m0-results`, removes only a stale result JSON, and resolves the exact executable path;
5. spawns `cradle-m0-gate.exe` with inherited environment plus absolute `CRADLE_M0_RESULT_PATH`, mode, and artifact path;
6. in a `finally`, writes `packaged-win32-x64.stdout.log` and `packaged-win32-x64.stderr.log`;
7. after a normal direct-process code 0, reads and validates the result JSON.

Fixture Main registers the privileged scheme at module scope, then checks mode/result-path, awaits Electron readiness, starts the fake upstream, installs the handler only on `session.defaultSession`, creates the hidden sandboxed window, and waits for renderer IPC. `finish()` runs the partition probe, waits five seconds for settled RSS, tears down the agent/server, atomically writes the result, logs PASS/FAIL, and calls `app.exit(0|1)`. Fatal Main or finalize errors call `app.exit(1)` but do not write a failure envelope.

This ordering yields two important facts:

- code 0 without JSON is not the fixture's intended success path, because intended success writes/renames JSON before `app.exit(0)`;
- `ENOENT` is a secondary runner symptom. It says only that the atomic result rename did not complete before the direct process exit observed by Node.

## Proven facts, inferences, and unknowns

### Proven

- **Artifact path resolution and OS-level spawn passed.** `access()` did not fail, `spawn()` did not emit ENOENT, and the runner observed a direct process outcome rather than its three-minute Windows timeout.
- **The direct process reported code 0.** This rules out the runner's explicit nonzero/signal/timeout branches, but it does not prove the Electron application lifecycle succeeded.
- **The accepted result JSON did not exist when the runner read it.** No Windows M0 assertion or measurement is available.
- **The runner masks the causal boundary.** It has no pre-spawn manifest, post-exit outcome file, earliest-Main checkpoint, crash event file, process-tree inventory, or result-missing diagnostic branch. Its final exception is therefore just `readFile(...json) -> ENOENT`.
- **The upload warning does not prove `.m0-results` was empty.** `run-m0.mjs` necessarily creates that directory before launch and, after any launch outcome, writes two log files in `finally`. Moreover `actions/upload-artifact@v4` ignores files inside dot-prefixed directories unless `include-hidden-files: true` is set; the tested workflow omitted that input. The action's own documented default is false. Thus the warning is consistent with hidden `.m0-results` logs being present but excluded. It cannot be used as evidence that the runner wrote no log files.
- **No product Windows package was tested.** The workflow stopped at M0 and skipped all later product build, package, native-module, application-e2e, installer, and installed-app steps.

### Reasonable inference

- The failure occurred **before `writeResult()` completed**, and most likely before `finish()` completed. That is the narrow process-lifecycle boundary supported by source and ENOENT.
- A startup or renderer failure could have happened before result finalization while Electron still returned code 0 or another Windows process outlived the direct child. Both shapes fit the observation. Neither is proved.
- The hidden upload default is the reason the already-designed stdout/stderr evidence was lost from the retained artifact. This is a workflow observability bug independent of the Electron runtime cause.

### Unknown

- whether packaged Main was loaded at all;
- whether `app.whenReady()` resolved in the hosted runner's non-interactive GUI session;
- whether the fake upstream, protocol handler, or hidden BrowserWindow was created;
- whether the window failed navigation, its renderer crashed/hung, or IPC never arrived;
- whether package metadata/ASAR contents/resources were wrong despite a successful builder exit;
- whether the spawned executable transferred work to another process that remained after the direct process exited;
- whether Windows Defender, crash handling, GPU initialization, session policy, or another runner condition intervened;
- whether stdout/stderr contained a useful Electron startup error. The run did not retain them.

## Cause classification

| Candidate | Disposition | Evidence and next discriminator |
| --- | --- | --- |
| Runner command/spawn error | **Not the observed failure** | The executable was resolved and spawned; direct outcome was code 0, not spawn error/timeout. Runner error handling is nevertheless defective because it reduces missing-result failure to ENOENT and loses diagnostics. |
| Result path construction/permission | **Path syntax largely ruled out; write path still unproved** | The runner uses an absolute path under the workspace and creates its parent directory. The same value is passed directly in the child's environment. There is no evidence Main received it or attempted a write, so environment receipt and rename remain unknown. |
| Packaging/build error | **Build success proved; package runtime integrity unknown** | electron-builder produced the expected executable, but the workflow does not inspect packaged `package.json`, ASAR entry, bundled preload/renderer files, or `resources/m0` before launch. A wrong/missing runtime entry remains possible. |
| GUI/session limitation | **Unknown, not established** | A hosted Windows runner and hidden window are compatible in principle, but this run has no `ready`, `did-fail-load`, `render-process-gone`, GPU, or crash evidence. Code 0 alone cannot classify it as a GUI failure. |
| Process-lifecycle/relaunch mismatch | **Plausible, unproved** | `runCommand()` watches only the PID returned by `spawn()` and settles immediately on its `exit`; on Windows it inventories no descendant/relaunched process. A code-0 direct exit plus missing result is compatible with this shape, but there is no process snapshot. |
| Electron Main startup error | **Plausible, unproved** | Main writes no checkpoint or failure envelope. A package-entry/import/ready failure could precede all result output. Intended fatal branches request code 1, so code 0 weakens but does not eliminate this candidate. |
| Custom-scheme/runtime assertion failure | **Not reached/proved** | A normal assertion failure would still enter `finish()`, write a result with failed assertions, and exit 1. Since there is no result, this run cannot be interpreted as evidence for or against the custom-scheme architecture. |

No single row beyond the observability defect is established as root cause. In particular, adding `--no-sandbox`, disabling GPU, showing the window, changing the scheme privileges, buffering streams, or weakening CSP/session isolation would be speculative and is not justified by this run.

## Minimum verifiable correction for the next run

This is an evidence-first correction, not a claim that runtime will pass.

1. **Retain the evidence that already exists.** Set `include-hidden-files: true` on the always-run M0 artifact upload, or copy the allowlisted `.m0-results` files to a non-dot artifact directory. Explicitly upload result JSON, runner stdout/stderr, lifecycle checkpoints, and builder effective config. Add an always-run PowerShell inventory that prints those exact paths, sizes, and timestamps before upload. Do not upload the workspace broadly.
2. **Write a runner diagnostic envelope independent of fixture success.** Before spawn, persist mode, SHA/run identifiers, cwd, resolved artifact/result/log paths, executable stat/hash/version metadata, selected environment-presence booleans, and start time. Immediately after direct-process settlement—and before reading result—persist PID, elapsed time, code, signal, timeout state, stdout/stderr byte counts, result existence, and relevant process inventory. Missing result must throw a message pointing to this envelope, never bare ENOENT.
3. **Add earliest-Main file checkpoints and fatal capture.** Write append-only checkpoints to an explicit diagnostic path at module evaluation and after scheme registration, `whenReady`, upstream start, handler install, window creation, navigation success/failure, renderer crash/unresponsive, `m0:complete`, `finish` start, temporary-result write, and atomic rename. Register `uncaughtException`, `unhandledRejection`, `render-process-gone`, `child-process-gone`, `did-fail-load`, and `unresponsive` evidence. These diagnostics are not acceptance results and must never allow a green gate.
4. **Make package and launch identity explicit.** Before launch, inspect the packaged ASAR/package metadata and assert the exact Main entry plus required bundled renderer/preload/resources. Record the executable/product version and SHA-256. At Main startup record `process.execPath`, `app.getAppPath()`, `process.resourcesPath`, `app.isPackaged`, Electron version, mode, and received absolute result path.
5. **Discriminate direct-process exit from application-tree exit.** Record the direct PID at spawn and inventory matching executable/process descendants at direct exit and after a short bounded observation window. If another fixture process remains, wait on/terminate the owned tree using an explicit Windows ownership mechanism and preserve both identities. If none remains, classify the first missing Main checkpoint as the startup boundary. Do not merely add an arbitrary sleep.

The smallest rerun may stop as soon as it captures the first missing checkpoint; it need not alter proxy behavior. The conditional functional fix is then narrow:

- no `module-evaluated` checkpoint: repair packaged entry/ASAR/module loading;
- module checkpoint but no `ready`: repair the observed Electron/runner startup condition;
- ready/handler but navigation or renderer crash: repair that concrete GUI/bundle failure;
- renderer completion but no rename: repair result finalization/path handling;
- direct PID exits while an owned app process remains: repair Windows process ownership/waiting;
- a complete failed JSON: address only the named M0 assertion and preserve the architecture STOP rules.

Required acceptance for the corrected run remains unchanged: `packaged-win32-x64.json` must validate at the exact revision with Electron 42.4.1, `launch.noSandbox: false`, sandboxed BrowserWindows, all required assertions true, valid raw RSS traces/bounds, cancellation/session/cleanup counters, and exact packaged artifact identity. A diagnostic envelope or code-0 executable is not a substitute.

## STOP and escalation

**STOP remains active for Plan 063 Node A.** Do not mark Windows M0 passed; do not begin Node C or route production renderer traffic through `cradle-server://local`; do not infer feasibility from Linux, unit, type, lint, bundle, or builder success.

This run does **not** establish an architecture STOP condition or justify Plan B, because it never produced evidence that the locked custom-scheme behavior itself was exercised and failed. It establishes a Windows runtime/observability STOP. After the evidence correction, one concrete runtime fix may be attempted against the first missing checkpoint. If a complete instrumented Windows run then demonstrates an Electron custom-scheme, streaming, cancellation, CSP/plugin, isolation, or memory STOP condition after one evidence-based correction, preserve all artifacts and escalate per the living ExecPlan without fallback, buffering, broader privileges/sessions, bearer exposure, or private Request/Response framing.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** exact run, revision, source path, observed outcome, evidence limits, classification, correction, acceptance boundary, and STOP are stated here.
- [x] **Tradeoffs and uncertainties explicit:** proven facts, reasonable inferences, and unknowns are separated; no GUI, package, startup, path, or process-tree cause is promoted without a discriminator.
- [x] **Acceptance criteria addressed:** runner, GUI, process lifecycle, path, packaging, startup, result generation, artifact retention, minimum correction, and Windows M0 status are each explicitly dispositioned.
- [x] **No implementation details leaked outside assigned scope:** this exploration changes no fixture, workflow, production source, routing, auth, privilege, or package behavior and writes only this assigned handoff.
- [x] **Human-review quality, honest/thorough/no marketing:** the report corrects the misleading upload inference, refuses to treat code 0 as success, gives a falsifiable next-run decision tree, and explicitly keeps Windows M0 and downstream production work blocked.
