# Exploration R: third Linux M0 runtime evidence and final disposition

**Task node:** Plan 063 M0 / Linux evidence-preservation rerun
**Exploration date:** 2026-08-13
**Requested head revision:** [`61b2ce9815e433de65648d0b7eed4ceec22d4a5d`](https://github.com/wibus-wee/cradle-app/commit/61b2ce9815e433de65648d0b7eed4ceec22d4a5d)
**CI run:** [`31631897209`](https://github.com/wibus-wee/cradle-app/actions/runs/31631897209), final conclusion `failure`
**M0 job:** [`94232462008`, Desktop M0 Custom Scheme](https://github.com/wibus-wee/cradle-app/actions/runs/31631897209/job/94232462008), final conclusion `failure`
**Retained artifact:** [`9155455275`, `desktop-m0-custom-scheme-31631897209`](https://github.com/wibus-wee/cradle-app/actions/runs/31631897209/artifacts/9155455275)
**Disposition:** **ARCHITECTURE STOP.** Development and packaged M0 both fail. The retained evidence identifies real fixture finalization/reporting defects, but those defects do not explain the packaged renderer's locked 128 MiB RSS-slope failure or the missing protocol-request abort. No single concrete fixture correction can make this conjunctive gate pass. Plan 063's production custom-scheme migration remains frozen; do not begin M1-M7, weaken the gate, add manual cancellation, broaden privileges/CSP/session access, fall back to renderer HTTP/1.1, or revive private Request/Response IPC. Any local HTTP/2-over-TLS Plan B requires a separate plan.

## Run, job, revision, and artifact identity

The requested run is terminal. Its M0 job steps were:

| Step | Conclusion |
| --- | --- |
| Checkout, setup, Electron/Xvfb dependencies | `success` |
| Run development custom-scheme gate | `failure` |
| Run packaged custom-scheme gate (`if: always()`) | `failure` |
| Upload M0 evidence (`if: always()`) | `success` |

The workflow run and artifact metadata identify head SHA `61b2ce9815e433de65648d0b7eed4ceec22d4a5d`. Because this was a pull-request workflow, checkout actually ran the synthetic merge commit `cba92719adb834bb0f06fc9dea469128e7a413d8`, recorded as “Merge `61b2ce…` into `d40f895e…`.” The runner diagnostic envelopes therefore record `GITHUB_SHA=cba9271…`, while the retained artifact's workflow metadata records the requested head SHA. The evidence is exact for this PR merge evaluation; it is not a head-only checkout claim.

Artifact `9155455275` is 12,461 compressed bytes, has digest `sha256:12df9434a727a0f2268b4fe053a4745a1a2de453176ba03943cc6e404765f97a`, expires 2026-08-19, and retained ten files. Crucially, it contains both diagnostic envelopes, both lifecycle JSONL files, stdout/stderr for both modes, and two complete temporary result payloads:

- `development-linux-x64.json.tmp-3659` — 14,032 bytes;
- `packaged-linux-x64.json.tmp-4029` — 16,378 bytes.

It does **not** contain either expected atomic final result (`development-linux-x64.json` or `packaged-linux-x64.json`). The runner consequently could not execute its normal final validator path. I parsed the complete temporary JSON payloads and also applied the current exact `validateM0Result` contract to them; each returns `ok: false`, including the raw Main 64 MiB bound and raw renderer 128 MiB non-linear bound. A temporary payload is not a passing result, but here it preserves decisive failed behavior evidence rather than leaving the run at an unexplained `ENOENT`.

## Separate mode dispositions

| Mode | Runtime/result disposition | Behavior disposition |
| --- | --- | --- |
| Development | Electron 42.4.1 reached the renderer and finalization, but the direct launcher exited code 0 with no atomic final JSON. The complete temporary payload says `passed: false`, with 16 required assertions true and 9 false. | **FAILED / not accepted.** Development additionally has a demonstrated real-plugin resource-root fixture bug, but cancellation and renderer RSS evidence remain independently failed. |
| Packaged | The exact ASAR-packaged unpacked executable reached the renderer and finalization, but exited code 0 during atomic rename. The complete temporary payload says `passed: false`, with the same 16 required assertions true and 9 false. | **FAILED / architecture-decisive.** The packaged renderer violates the locked 128 MiB slope; protocol `Request.signal` never aborts; and real-plugin activation fails under the required CSP/custom-scheme shape. |

This gate is conjunctive. Passing GET/POST, streaming first-byte, request streaming, multipart, image, PDF, simple module, CSP declaration, isolation, and cleanup cannot compensate for any required failure.

## Exact assertion evidence

Both temporary payloads report the same nine assertion names false:

1. `response.cancel.invokedOnce`
2. `response.cancel.reachesUpstream`
3. `binary.64MiB.digestAndLength`
4. `binary.64MiB.mainRssBound`
5. `binary.64MiB.rendererRssBound`
6. `binary.128MiB.nonLinearMainRss`
7. `binary.128MiB.nonLinearRendererRss`
8. `subresource.dynamicModule.realPlugin`
9. `subresource.dynamicModule.dependenciesStayCustomScheme`

Both report these sixteen required assertions true:

- exact five enabled/four disabled scheme privileges;
- default-session handler installed and BrowserPanel partition unhandled;
- GET/query/headers, POST binary body, and non-2xx response parity;
- first byte roughly one second before response completion;
- streamed request body (`786,432` bytes; 24 upstream chunks; 550 ms development / 551 ms packaged first-to-last);
- multipart bytes/content type;
- image, PDF, and simple dynamic module;
- representative strict CSP and `bypassCSP: false`;
- active requests zero and Agent/upstream closed.

There is a reporting-granularity defect in the renderer fixture: the three 64 MiB assertions share one `try/catch`, and the two 128 MiB assertions share another. The Main 64 MiB check throws after byte count, rolling digest, and renderer delta have already satisfied their direct checks, so all three 64 MiB names are marked false with the same Main-RSS error. Likewise, the 128 MiB renderer check throws after the Main non-linear check has passed, so both 128 MiB names are marked false. The raw traces below are the authoritative discriminator; this reporting defect does not remove the actual Main-64 or renderer-128 violations.

## Cancellation evidence

| Counter | Development | Packaged | Required interpretation |
| --- | ---: | ---: | --- |
| `responseCancels` | 1 | 1 | Chromium invoked the returned response stream's `cancel()` exactly once. |
| `requestSignalAborts` | 0 | 0 | The incoming `protocol.handle` `Request.signal` never aborted. |
| `upstreamCloses` | 1 | 1 | The undici/fake-upstream stream closed exactly once. |
| `activeRequests` | 0 | 0 | Proxy cleanup completed. |
| `cancelStreamChunks` | 1 | 1 | No continued chunk growth was reported after cancellation settling. |

The exact failure in both modes is `Error: incoming protocol Request.signal did not abort`. This is not a zero-cancellation observation: response-stream cancellation and upstream closure both work. It is nevertheless a hard failure of the committed validator and of Exploration E's locked end-to-end cancellation evidence. The permitted response-body `cancel()` path already ran; adding explicit renderer `reader.cancel()`, a second manual signal, IPC, or a relaxed `requestSignalAborts` invariant would change the truth condition rather than correct an evidenced wiring defect.

## Exact RSS evidence

All values are KiB. The Linux 64 MiB gate is `<49,152` KiB per process; the provisional calibration ceiling is still strictly below `65,536` KiB. The locked 64-to-128 MiB increase is at most `16,384` KiB and may not be raised.

| Mode/process | 64 MiB baseline → peak | 64 MiB delta | 128 MiB baseline → peak | 128 MiB delta | Delta increase from 64 to 128 | Disposition |
| --- | --- | ---: | --- | ---: | ---: | --- |
| Development Main | 224,564 → 282,212 | 57,648 | 265,160 → 287,000 | 21,840 | -35,808 | 64 MiB exceeds 48 MiB but remains below 64 MiB; calibration candidate in isolation. Main slope passes. |
| Development renderer | 102,624 → 150,416 | 47,792 | 140,552 → 222,556 | 82,004 | **34,212** | 64 MiB passes; slope exceeds 16 MiB by **17,828**. |
| Packaged Main | 232,108 → 290,032 | 57,924 | 287,096 → 294,628 | 7,532 | -50,392 | 64 MiB exceeds 48 MiB but remains below 64 MiB; calibration candidate in isolation. Main slope passes. |
| Packaged renderer | 98,084 → 145,548 | 47,464 | 136,372 → 221,176 | 84,804 | **37,340** | 64 MiB passes; slope exceeds 16 MiB by **20,956**. |

The traces contain 21/40 samples in development and 20/39 samples packaged at about 25 ms cadence. The packaged renderer rises from 136,372 KiB to 221,176 KiB during the 128 MiB transfer despite consuming chunks one at a time without retaining them, then drops in later samples. This is exactly the transient body-size-dependent peak the M0 gate was designed to catch. Raising the 64 MiB Main threshold alone cannot repair it; the renderer slope is explicitly non-calibratable under Exploration E.

## Real-plugin, custom-scheme, and CSP evidence

### Development

- Simple `cradle-server://` module import passed.
- Real-plugin import failed with `TypeError: Failed to fetch dynamically imported module: cradle-server://local/api/plugins/system-info/web.mjs`.
- `customSchemeModuleHits` is exactly 2: the simple module and attempted real-plugin module reached the handler; no dependency wrapper reached it.
- The lifecycle records development `resourceRoot` as `/home/runner/work/cradle-app/cradle-app/apps/desktop/dist/m0/main/dist/m0/fixture-resources`. The preparation script writes resources at `apps/desktop/dist/m0/fixture-resources`. This duplicated `dist/m0/main/dist/m0` segment is a concrete development-only fixture path defect and explains the resource read failure.

### Packaged

- Simple module import passed.
- The real plugin and dependency graph reached the custom scheme far enough to produce `customSchemeModuleHits: 5`.
- Evaluation then failed at `cradle-server://local/api/plugins/system-info/web.mjs:7746:1` with `ReferenceError: process is not defined`.
- The prepared real bundle contains browser-evaluated `process.env.NODE_ENV` references. This is a real-plugin bundle/preparation compatibility defect rather than proof that the custom-scheme fetch itself failed.
- The result schema does not persist the otherwise available `realPluginHits` and `dependencyHits` diagnostics, and the renderer throws before recording them in assertion details. Therefore their exact split cannot be claimed from this artifact. Five handler hits plus a passing simple import prove five custom-scheme module requests, but not the precise plugin/dependency route counts.
- Representative CSP passed, contained no HTTP(S) allowance, `bypassCSP` remained false, scheme privileges stayed exact, and the BrowserPanel partition remained denied. There is no evidence of an HTTP(S), ticket, broad-session, or CSP-bypass fallback.

The plugin evidence exposes correctable fixture/bundle problems, but correcting them would not change the independent packaged renderer RSS slope or the absent request-signal abort.

## Lifecycle and diagnostic evidence

Both modes reached all behavior execution checkpoints: module evaluation, exact scheme registration, `app.whenReady()`, fake upstream, default-session handler, sandboxed/context-isolated window creation, successful renderer navigation, `renderer.complete-received` with 19 renderer assertions, partition probe, five-second RSS settle, window destruction, protocol unhandle, and Agent/server closure.

Security/launch evidence is exact in both modes:

- Electron `42.4.1`, Linux x64;
- process-level `--no-sandbox` requested and observed only under the accepted GitHub Actions policy;
- renderer `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`;
- five enabled and four disabled custom-scheme privileges;
- `partitionHits: 0`.

The packaged diagnostic identifies the exact launched executable and ASAR:

- `release/m0/linux-unpacked/cradle-m0-gate`: 217,464,024 bytes, SHA-256 `c9579fdd1ab6491022b99c497f9b3c3009ef2cdea04f9b1e623c642f4015915c`;
- `release/m0/linux-unpacked/resources/app.asar`: 27,916,884 bytes, SHA-256 `81f3f1d01849994d3b2d27d657032a1b08d974932a2a606cdb9eb0110006c874`.

The development direct process (`pid 3612`, Electron child `pid 3659`) settled code 0, no signal, no timeout, after 19,228 ms. Its lifecycle ends at sequence 24, `finalize.result-temporary-write-start`; the complete temp file exists, but there is no temporary-write-complete, rename-start, rename-complete, or finalize-complete checkpoint.

The packaged direct Electron process (`pid 4029`) settled code 0, no signal, no timeout, after 10,969 ms. Its lifecycle ends at sequence 26, `finalize.result-rename-start`; the complete temp file exists, but there is no rename-complete or finalize-complete checkpoint. Packaged stdout is zero bytes; stderr contains only Linux D-Bus diagnostics. Neither lifecycle contains `finalize.fatal`, `top-level.fatal`, `uncaught-exception`, or `unhandled-rejection`.

The source destroys both BrowserWindows before `writeResult()` writes and renames the result. On Linux, closing the last windows permits Electron to exit while the asynchronous write/rename is in flight. The symmetric temp-file/checkpoint boundary makes this a concrete finalization-order fixture defect, not an unknown runtime blocker. Moving result persistence before last-window destruction (or otherwise explicitly retaining app lifetime through the atomic rename) is the narrow correction, but it would only expose the same `passed: false` payload to the runner. It is not a behavior correction and cannot turn this run into M0 acceptance.

## Plan classification and next action

**Classification: ARCHITECTURE STOP, not ONE-CORRECTION and not EVIDENCE/RUNTIME-BLOCKER.**

The evidence-preservation goal succeeded: both modes ran independently and the artifact retained complete behavior payloads plus lifecycle/runner diagnostics. The missing final rename is now diagnosed, so this is no longer an evidence/runtime blocker. The development resource path, plugin bundle global, grouped assertion reporting, and finalization order are concrete defects, but they are multiple independent fixture/bundle defects and none explains the packaged renderer's raw 37,340 KiB slope or `requestSignalAborts: 0`.

Plan 063 directly says to stop when Electron 42.4.1 custom protocols cannot provide cancellation with bounded memory in the packaged app, and Exploration E says the renderer 64-to-128 MiB slope may not exceed 16 MiB. The packaged renderer exceeds it by 20,956 KiB. That direct STOP condition does not require spending the one reasonable correction merely to make the already-preserved failed JSON rename successfully. The separate “verification fails twice after a reasonable correction” rule is an additional STOP condition, not a requirement to attempt a correction after a decisive non-calibratable packaged failure.

Required next action:

1. Keep production renderer routing and M1-M7 frozen.
2. Record this run/artifact and the architecture STOP in the living ExecPlan and Plan 063 without marking any M0 sub-behavior as an overall pass.
3. Do not rerun merely after fixing atomic rename, development resource root, assertion grouping, or plugin `process` substitution; those cannot cure the decisive packaged memory/cancellation evidence.
4. If the product still requires a pool fix, open the separately designed local HTTP/2-over-TLS Plan B decision. Do not implement it inside Plan 063 and do not resurrect process IPC framing.

## Honest uncertainties

- The runner never read an atomic final JSON; conclusions use the complete retained temporary JSON files and raw lifecycle/diagnostic evidence. Their `passed: false` state and raw measurements are internally consistent, but they are not successful runner-validation records.
- The PR workflow executed a synthetic merge SHA, not a head-only checkout. No material merge drift was observed in the inspected M0 output, but this handoff does not claim a head-only runtime.
- Exact packaged `realPluginHits` and `dependencyHits` were not persisted. `customSchemeModuleHits: 5`, the custom-scheme stack URL, and the `process` exception prove fetch/evaluation progress but not their exact counter split.
- The evidence shows that the incoming protocol request signal does not abort while response cancellation still closes upstream. It does not establish whether a future Electron version changes that behavior; Plan 063 is locked to Electron 42.4.1.
- This exploration did not modify or run production routing, Server auth, Chat behavior, or the unrelated untracked `apps/server/src/http/websocket-ticket.ts`.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** exact requested and checkout revisions, final run/job/step conclusions, artifact identity/digest/content, separate mode dispositions, assertions, counters, RSS, plugin, lifecycle, diagnostics, and next action are all stated here.
- [x] **Tradeoffs and uncertainties explicit:** atomic-finalization, development resource-root, assertion-reporting, and plugin-bundle defects are separated from the decisive packaged RSS/cancellation failures; temporary-result, PR-merge, and missing plugin-counter limits are explicit.
- [x] **Acceptance criteria addressed:** both development and packaged modes are dispositioned; exact launch/security/session evidence, cancellation counts, memory traces and locked thresholds, real-plugin/CSP behavior, cleanup, and Plan STOP criteria are evaluated without partial-pass promotion.
- [x] **No implementation details leaked outside assigned scope:** this exploration changes no fixture, workflow, production/test source, plan, auth, package, or forbidden Server file; its only repository output is this handoff.
- [x] **Human-review quality, honest/thorough/no marketing:** the report distinguishes reported assertions from raw truth, refuses to treat code 0 or temp JSON as acceptance, refuses an evidence-only rerun as a behavior fix, and gives one falsifiable Plan-level disposition.
