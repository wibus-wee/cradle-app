# Exploration S: third Windows packaged M0 runtime evidence

**Task node:** Plan 063 M0 / Windows x64 evidence-preservation rerun
**Exploration date:** 2026-08-13
**Requested head revision:** [`61b2ce9815e433de65648d0b7eed4ceec22d4a5d`](https://github.com/wibus-wee/cradle-app/commit/61b2ce9815e433de65648d0b7eed4ceec22d4a5d)
**Workflow run:** [`31631897216`](https://github.com/wibus-wee/cradle-app/actions/runs/31631897216)
**Job:** [`94232461652`](https://github.com/wibus-wee/cradle-app/actions/runs/31631897216/job/94232461652), `Package Windows Desktop`
**Artifact:** [`9155482787`](https://github.com/wibus-wee/cradle-app/actions/runs/31631897216/artifacts/9155482787), `cradle-windows-package`
**Disposition:** **ONE CONCRETE FIXTURE CORRECTION. Windows M0 remains failed and production migration remains blocked.** Keep the Electron app alive after the final BrowserWindows are destroyed until `writeResult()` completes its atomic rename and the fixture reaches its explicit `app.exit(...)`. Do not change an assertion, RSS threshold, cancellation condition, plugin/CSP condition, privilege, session, or security setting in that correction.

## Run and revision identity

The Actions run is complete with conclusion `failure`. Run metadata associates the workflow with head SHA `61b2ce9815e433de65648d0b7eed4ceec22d4a5d`, branch `agent/replan-desktop-server-transport`, attempt 1. Because this was a pull-request event, `actions/checkout` actually checked out synthesized merge commit `cba92719adb834bb0f06fc9dea469128e7a413d8`, logged as “Merge 61b2ce... into d40f895e...”. The runner diagnostic consequently records `GITHUB_SHA=cba92719...`. This is not a claim that the workflow checked out the head commit detached from its PR base; it is the normal PR merge-ref execution containing the requested head revision.

The hosted environment was Microsoft Windows Server 2025 `10.0.26100`, runner image `windows-2025-vs2026` version `20260803.193.1`, Node `v24.18.1`, pnpm `11.2.2`, Electron `42.4.1`, `win32-x64`. Setup passed. `Run packaged M0 custom-scheme gate` failed; every subsequent product build/package/native-module/e2e/installer step was skipped. The always-run artifact upload passed and retained five hidden evidence files.

The run links above are the evidence authority. The artifact is 5,849 bytes, has artifact ZIP digest `sha256:e52febd696c0d83f5f9eac65f38123030a8b850a161875ef15b7e3d57438d397`, was created at `2026-08-12T19:19:56Z`, and expires at `2026-11-10T19:17:11Z`.

## Packaged step and exact settlement

The packaged command was:

```text
pnpm --filter @cradle/desktop m0:custom-scheme:packaged
```

The fixture built the real system-info plugin, bundled Main/preload/renderer, and packaged Electron `42.4.1` into:

```text
D:\a\cradle-app\cradle-app\apps\desktop\release\m0\win-unpacked\cradle-m0-gate.exe
```

The diagnostic envelope proves the executable and ASAR existed before launch:

| File | Size | SHA-256 |
| --- | ---: | --- |
| `cradle-m0-gate.exe` | 232,313,344 bytes | `13234c81f813097f67b5ab45ef31c522ae88b44db61c521bdf2bf107d67314e2` |
| `resources/app.asar` | 34,033,386 bytes | `e01d8e8224505a5f82094abd259652c292cd9af1f080cab856f26fb9f5e3f88a` |

The runner launched the executable directly with no arguments, a 180,000 ms timeout, no process `--no-sandbox` switch, and absolute result/lifecycle/artifact paths present in the environment. The exact direct-process settlement was:

| Field | Value |
| --- | --- |
| PID | `5808` |
| started | `2026-08-12T19:19:43.603Z` |
| settled | `2026-08-12T19:19:55.450Z` |
| elapsed | `11,846 ms` |
| exit code | `0` |
| signal | `null` |
| timed out | `false` |
| captured stdout | 2 bytes, exactly CRLF (`0d 0a`) |
| captured stderr | 0 bytes |
| matching executable after settlement | none (`tasklist` returned “No tasks are running which match the specified criteria.”) |

The job then failed in `run-m0.mjs` because canonical `packaged-win32-x64.json` did not exist. Code 0 is not an M0 pass: intended fixture completion atomically renames the result, records `finalize.complete`, and explicitly exits 0 or 1 according to the result.

## Retained evidence inventory

Artifact `9155482787` contains exactly these five files:

| Evidence | Bytes | SHA-256 | Finding |
| --- | ---: | --- | --- |
| `packaged-win32-x64.diagnostic.json` | 3,945 | `6b1fc70274820ded0c4934544d58bc14a5706ab1900c96de41891a4e1ac80d25` | Complete runner envelope and direct-process settlement. |
| `packaged-win32-x64.json.tmp-5808` | 16,847 | `a7370f5dc0e6fa9de7eb7f8e352f5ad033aac46323732bca38575715ce677fd3` | Parseable, complete-looking temporary runtime result with `passed:false`; never renamed to the canonical result path. |
| `packaged-win32-x64.lifecycle.jsonl` | 11,022 | `a90be3ecb2fc5cc7428513f770544d78016bea2e6428c3724f2c584b0bea4d10` | 24 ordered Main lifecycle records. |
| `packaged-win32-x64.stdout.log` | 2 | `7eb70257593da06f682a3ddda54a9d260d4fc514f645237f5ca74b08f8da61a6` | CRLF only. |
| `packaged-win32-x64.stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Empty. |

The canonical `packaged-win32-x64.json` is absent. The temp file is useful diagnostic evidence, but Plan 063 requires valid atomic canonical result JSON; it cannot be substituted for acceptance.

## Earliest reached and missing Main checkpoint

Main reached far beyond startup. The ordered lifecycle proves all of the following:

1. module evaluation and exact scheme registration;
2. `app.whenReady()` with `appIsPackaged:true`, Electron `42.4.1`, ASAR app path, and `noSandbox:false`;
3. fake upstream ready;
4. default-session protocol handler installed and reported handled;
5. sandboxed/context-isolated renderer window created, navigation finished, and renderer completion received with 19 renderer assertions;
6. partition probe completed;
7. the five-second settle interval completed;
8. both windows were destroyed;
9. the default-session protocol was unhandled;
10. the undici Agent and fake upstream were both closed;
11. `finalize.result-temporary-write-start` was recorded.

The **last reached checkpoint is sequence 24, `finalize.result-temporary-write-start`, at `2026-08-12T19:19:55.258Z`**. A valid 16,847-byte temp JSON owned by PID 5808 exists, proving the write reached the filesystem. The **earliest missing checkpoint is `finalize.result-temporary-write-complete`**. Consequently `finalize.result-rename-start`, `finalize.result-rename-complete`, and `finalize.complete` are also absent.

There is no `main.fatal`, `finalize.fatal`, uncaught exception, unhandled rejection, renderer crash, failed navigation, or unresponsive event. The direct process settles code 0 about 192 ms after `finalize.windows-destroyed` and about 192 ms after the temp write starts, with no matching process left. Combined with current source—which destroys the last two BrowserWindows before awaiting `writeResult()` and has no `window-all-closed` listener—this is strong evidence that Electron's default last-window lifecycle terminates the Windows app while the asynchronous result write is between filesystem completion and its promise continuation. It is not proof of a filesystem permission, path, rename, process-tree, GUI-session, ASAR-entry, or renderer-startup failure.

## Temporary result behavior evidence

The temporary result is valid JSON and records `passed:false`, packaged Electron `42.4.1`, `launch.noSandbox:false`, `launch.rendererSandbox:true`, exact five enabled/four disabled privileges, default-session handling, BrowserPanel-partition denial, successful cleanup, and these passing behavior areas: GET/POST/non-2xx parity, first-byte streaming (1,000 ms lead), streamed multi-chunk upload, multipart, image, PDF, simple custom-scheme module, strict representative CSP, zero active requests, and closed Agent/upstream.

It also preserves direct failure evidence. These are not accepted and must survive the correction unchanged unless a later, separately authorized behavior correction is justified:

- **Cancellation:** `responseCancels=1`, `upstreamCloses=1`, `activeRequests=0`, and `cancelStreamChunks=1`, but `requestSignalAborts=0`. The renderer records `incoming protocol Request.signal did not abort`; both required cancellation assertions are false. The response-stream cancel path did run and the upstream closed, so the exact relationship between Electron's incoming `Request.signal` and returned-body cancellation remains a fixture/product capability question, not a pass.
- **64 MiB RSS:** Main baseline/peak were `120,144/184,320 KiB`, delta `64,176 KiB`; renderer baseline/peak were `77,620/123,864 KiB`, delta `46,244 KiB`. Main exceeds the ordinary 48 MiB bound but remains 1,360 KiB below the Plan's absolute `<64 MiB` one-calibration ceiling. The fixture's grouped catch also marks the already-completed 64 MiB digest and renderer-bound assertion false after the Main-bound check throws; the temp result therefore does not supply the detail fields required by the strict validator.
- **128 MiB slope:** Main baseline/peak were `137,472/186,744 KiB`, delta `49,272 KiB`, which is lower than its 64 MiB delta. Renderer baseline/peak were `113,068/200,148 KiB`, delta `87,080 KiB`, which is `40,836 KiB` above the 64 MiB renderer delta and exceeds the locked `+16 MiB` slope. Raw 25 ms samples show renderer working set rising broadly with transfer progress before dropping near completion; this is a direct STOP candidate, not an allowed threshold calibration.
- **Real plugin:** the simple module and five custom-scheme module handler hits occurred, but the real system-info bundle failed at `cradle-server://local/api/plugins/system-info/web.mjs` with `ReferenceError: process is not defined`. The prepared repository bundle contains un-replaced `process.env.NODE_ENV` references. Real-plugin activation and the dependent equality assertion are false. Whether the preparation fixture omitted a browser build replacement or the real production module shape is incompatible remains unresolved; CSP and scheme routing themselves were reached.

These failures are conjunctive. Passing subtests cannot compensate for them, and the temp result cannot be called a canonical failed result because the required atomic rename did not happen.

## Classification and one authorized next action

**Classification: one concrete fixture correction, not M0 acceptance, not an evidence/runtime blocker, and not yet an architecture-STOP declaration from this Windows node.** The evidence is sufficient to select the first-missing-boundary correction:

> Register an explicit fixture-owned `window-all-closed` handler before any fixture window can close so destruction of the final Windows BrowserWindow cannot trigger default application exit while `finish()` is awaiting the atomic result write. Keep the process alive until `finalize.result-temporary-write-complete`, rename start/completion, and `finalize.complete` are durably recorded, then retain the existing explicit `app.exit(result.passed ? 0 : 1)` as the only normal terminal decision.

This is narrower than changing teardown order or adding a sleep: it fixes the observed Electron application-lifetime boundary while preserving the current cleanup sequence, direct process identity, timeout, result contract, and truth conditions. The corrected run must still exit nonzero for the currently recorded failed behavior unless a separately reviewed Plan decision authorizes one evidence-backed behavior correction. It must retain the temp/canonical files and all raw traces on failure.

Architecture STOP candidates are now real rather than hypothetical—especially the 128 MiB renderer slope, incoming `Request.signal` behavior, and real-plugin environment assumption—but this exploration does not combine three behavior changes with the lifetime correction or choose a speculative workaround. After the single lifecycle-correct rerun, apply Plan 063 literally: accept only a canonical atomic result with every assertion true; otherwise select at most one independently justified fixture/measurement correction if the plan owner concludes one defect accounts for the failures, or declare architecture STOP. Do not raise the 64 MiB ceiling, raise the 16 MiB slope, add manual renderer cancellation, buffer bodies, inject Node into production renderers, broaden CSP/privileges/sessions, add HTTP fallback, or invent private Request/Response IPC.

Until then:

- Windows packaged M0 is **failed**;
- development-plus-packaged M0 is **not accepted**;
- Plan 063 Nodes C and later production routing remain unauthorized;
- no product Windows package/e2e result exists from this run because all later workflow steps were skipped.

## Honest uncertainties

- No lifecycle record can observe the exact internal Electron default-quit event because the current fixture does not subscribe to `window-all-closed`, `before-quit`, `will-quit`, or `quit`. The last-window explanation is a source-and-timing inference, albeit a strong and falsifiable one.
- The temp JSON was fully parseable after artifact download, but there is no `writeFile` completion record; filesystem flush completion before process exit is not independently proved.
- Local Linux execution of `validateM0Result` cannot faithfully validate the Windows absolute `artifactPath` because Node's `path.isAbsolute` is host-platform-specific. The Windows runner never reached validation. The assertion/counter/raw-memory failures above come directly from the result fields and contract, not from claiming a successful cross-platform validator run.
- This node did not execute a behavior correction, Windows rerun, development mode, or Linux packaged mode. It does not prove whether the cancellation, renderer RSS, or real-plugin failures are ultimately correctable with supported Electron APIs.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** exact head and merge-ref identity, run/job/artifact links and IDs, platform, command, package identity, process settlement, retained file inventory, checkpoint boundary, temp-result behavior, classification, and next action are recorded here.
- [x] **Tradeoffs and uncertainties explicit:** canonical versus temporary result status, strong last-window inference versus direct proof, calibration ceiling versus locked slope, fixture versus product explanations, skipped downstream workflow work, and host-platform validation limits are separated.
- [x] **Acceptance criteria addressed:** Electron/version/launch identity, scheme/default-session/partition/CSP state, streaming, cancellation, request upload, multipart, binary RSS and slope, image/PDF/modules, cleanup, atomic result requirement, and Plan 063 STOP boundary are each dispositioned without partial-pass substitution.
- [x] **No implementation details leaked outside assigned scope:** this exploration changes no fixture, test, workflow, plan, production source, routing, auth, privilege, package behavior, or forbidden Server file; it writes only this assigned Exploration S handoff.
- [x] **Human-review quality / honest, thorough, non-marketing:** code 0 is not called success, the parseable temp file is not promoted to canonical acceptance, all negative evidence and uncertainties remain visible, the correction is falsifiable and narrow, and downstream production work stays blocked.
