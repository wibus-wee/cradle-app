# Synthesis U: Plan 063 M0 third-runtime final classification

**Task node:** Plan 063 M0 / final synthesis of the third Linux and Windows runtime evidence
**Synthesis date:** 2026-08-13
**Evidence scope:** only the governing Plan 063, its Desktop transport ExecPlan, Exploration R, Exploration S, and Critique T
**Runtime scope:** Linux run `31631897209` / job `94232462008` / artifact `9155455275`, and Windows run `31631897216` / job `94232461652` / artifact `9155482787`; both evaluated requested head `61b2ce9815e433de65648d0b7eed4ceec22d4a5d` through PR merge commit `cba92719adb834bb0f06fc9dea469128e7a413d8`

## Final classification

**ARCHITECTURE STOP immediately.** This synthesis selects exactly one of the two permitted outcomes: it selects **Architecture STOP**, not a fixture correction/rerun.

M0 is failed and not accepted. Plan 063's custom-scheme production migration remains frozen, and **M1-M7 are not authorized to begin**. No additional Plan 063 feasibility rerun is authorized merely to obtain canonical atomic result files. The finalization/lifetime defect may be repaired later only as separately authorized fixture maintenance; it is neither a predecessor to this STOP decision nor a correction to the failed behavior.

The independently sufficient basis is the locked renderer RSS hard-slope violation, reproduced in Linux development, Linux packaged, and Windows packaged execution. The missing incoming `Request.signal` abortion is an additional committed gate failure but has a semantic uncertainty that makes it unsuitable as the sole architectural basis. The real-plugin failures are required M0 failures but are most directly attributable to fixture/resource preparation defects rather than demonstrated custom-scheme or CSP infeasibility. Neither qualification weakens the RSS-based STOP.

## Governing decision boundary

Plan 063 makes M0 a mandatory packaged-Electron feasibility predecessor. Production migration may begin only if development and packaged Electron 42.4.1 satisfy the required custom-protocol behaviors. If required packaged streaming/cancellation/bounded-memory behavior cannot be made reliable with supported APIs, the Plan requires STOP and forbids hidden buffering, renderer HTTP fallback, broadened privilege/session/CSP access, or private Request/Response IPC framing.

The ExecPlan makes M0 acceptance conjunctive: development and ASAR-packaged unpacked executions must produce valid atomic result JSON and every named assertion must be true. It also says that a failed M0 must preserve JSON, logs, and measurements and then stop. Atomic canonical publication is therefore mandatory for PASS and normal runner completion, but the governing documents do not make successful canonical rename a prerequisite for using complete, attributable negative diagnostics.

After the earlier Linux run lost the raw evidence, the governing records authorized an evidence-preservation-only rerun, followed by one of two bounded outcomes: one concrete, evidence-based behavior correction, or Architecture STOP. That rerun achieved its diagnostic purpose. A correction that only repairs result delivery does not explain a behavior failure and cannot insert another feasibility stage between evidence preservation and the required decision.

## Reconciliation of the competing classifications

Exploration R reaches the correct Plan-level next action but overstates one proposition. The evidence does not prove that no imaginable future supported-API change could ever affect multiple symptoms. The narrower and supported conclusion is that **no presently evidenced, permissible single correction accounts for the decisive packaged failures while preserving all locked truth conditions**. That is sufficient under the Plan's bounded correction rule; speculative rescue work is not authorized.

Exploration S correctly identifies a real, narrow lifecycle/finalization defect. The complete PID-scoped temporary result, the last lifecycle checkpoint, the code-0 process settlement shortly after final-window destruction, and the lack of fatal records strongly support premature app exit during asynchronous result persistence. S also correctly refuses to treat code 0, a parseable temp file, or partial subtest success as M0 acceptance.

S's Plan-level classification is nevertheless rejected. Holding the fixture alive through atomic publication could produce the missing canonical file and intended nonzero failed exit, but it cannot change the already-completed cancellation counters, RSS samples, or plugin evaluation. Requiring that correction and rerun before acting on those measurements would add an ungranted `evidence preservation -> finalization rerun -> possible behavior correction -> decide` sequence. The authorized sequence was `evidence preservation -> one justified behavior correction or STOP`.

Critique T resolves this conflict correctly: canonical atomic JSON is a hard predecessor to PASS, not a hard predecessor to a fail-closed negative decision. This synthesis adopts that distinction and bases the final STOP on raw, repeated, non-calibratable RSS evidence rather than on the missing canonical result, grouped assertion labels, or an ambiguous cancellation interpretation.

## Evidence-by-evidence effect

| Evidence class | Observed fact | Effect on PASS | Effect on STOP / diagnosis | Final weight |
| --- | --- | --- | --- | --- |
| Canonical atomic result | No canonical final JSON exists for Linux development, Linux packaged, or Windows packaged; the direct processes settled code 0 before the intended result/exit contract completed. | Independently blocks M0 PASS and prevents claiming normal runner validation/completion. | Absence alone proves non-acceptance but does not identify architectural infeasibility. Successful rename is not required before complete sibling diagnostics may support a negative decision. | **Decisive against PASS; not the architectural STOP basis.** |
| Complete temp result and raw trace | Each retained PID-scoped temp payload is parseable, mode/platform/PID-attributable, says `passed:false`, and is paired with lifecycle/runner envelopes and raw counters/RSS samples from the exact artifact execution. | Cannot substitute for canonical atomic JSON and cannot be called a canonical failed result or a passing validator record. | Sufficient to diagnose raw behavior failures and, where independently replicated against a locked metric, to apply STOP. Grouped assertion-reporting defects do not invalidate the underlying numeric traces. | **Valid and sufficient negative evidence; never acceptance evidence.** |
| Incoming `Request.signal` | `requestSignalAborts: 0` in Linux development, Linux packaged, and Windows packaged. In each mode `responseCancels: 1`, `upstreamCloses: 1`, `cancelStreamChunks: 1`, and `activeRequests: 0`. | Fails the committed M0 assertion and the frozen evidence contract, so the gate cannot pass. | The higher-level outcome is mixed: returned-body cancellation ran, upstream closed, growth stopped, and cleanup completed. Whether incoming protocol `Request.signal` must itself abort is a product-semantics uncertainty. No evidenced production-equivalent wiring defect supports a permissible correction, but this synthesis does not make the signal counter the sole STOP basis. | **Hard gate failure; corroborating, not independently relied on for Architecture STOP.** |
| RSS hard slope | Renderer 64-to-128 MiB peak-delta increase is `34,212 KiB` in Linux development, `37,340 KiB` in Linux packaged, and `40,836 KiB` in Windows packaged. The locked maximum is `16,384 KiB`. | Fails a mandatory bounded-memory assertion in every retained mode. | The slope is expressly non-calibratable. It is reproduced across both packaged operating systems and also in development, using raw roughly 25 ms working-set samples that show broad transfer-correlated growth. No supplied evidence identifies a measurement defect that could permissibly remove it. | **Independently sufficient Architecture STOP evidence.** |
| Real plugin | Linux development used a duplicated resource-root path and failed to fetch the real plugin. Both packaged runs reached five custom-scheme module-handler hits and then failed with `ReferenceError: process is not defined` from unreplaced `process.env.NODE_ENV`; simple module import, strict CSP, exact privileges, default-session handling, partition denial, and `bypassCSP:false` passed. | Real-plugin and dependency assertions remain false, so M0 cannot pass. | The immediate packaged symptom is most consistent with bundle/preparation shape, not proof that custom-scheme fetch, module evaluation, or CSP capability is inherently broken. Exact real-plugin/dependency hit split was not persisted. A legitimate preparation correction could address only this domain and would not cure RSS or cancellation. | **Required gate failure, likely fixture-preparation defect, not the decisive architecture evidence.** |

## Canonical atomic result versus retained negative evidence

The distinction is deliberately asymmetric:

1. **M0 PASS:** impossible from these runs. The canonical files are absent, the runner did not complete its success-oriented validation path, the direct exit contract is wrong, and the temporary payloads say `passed:false`.
2. **Run failed / not accepted:** established independently by the absent canonical files and by the retained failed payloads.
3. **Specific behavior diagnosis:** permitted where the temp payload contains complete raw fields tied to the exact PID, mode, platform, executable/ASAR identity, lifecycle, and runner envelope. Those conditions are reported for all three executions.
4. **Architecture STOP:** supported by the same locked renderer slope being exceeded in Linux packaged and Windows packaged, with Linux development as an independent third reproduction. The result-delivery defect cannot cause already-recorded transfer peaks.

The temporary payloads would be inadequate if they were truncated, stale, mode-mismatched, unattributable, or missing raw samples. The reviewed evidence reports the opposite. Conversely, the files must not be promoted to canonical results merely because they are complete and parseable.

## RSS disposition in detail

All values below are KiB:

| Mode/process | 64 MiB delta | 128 MiB delta | Increase | Limit | Disposition |
| --- | ---: | ---: | ---: | ---: | --- |
| Linux development renderer | 47,792 | 82,004 | 34,212 | 16,384 | Fails by 17,828 |
| Linux packaged renderer | 47,464 | 84,804 | 37,340 | 16,384 | Fails by 20,956 |
| Windows packaged renderer | 46,244 | 87,080 | 40,836 | 16,384 | Fails by 24,452 |

The Main-process 64 MiB deltas are a separate issue: Linux development `57,648`, Linux packaged `57,924`, and Windows packaged `64,176`. They exceed the ordinary 48 MiB bound but remain below the Plan's absolute 64 MiB calibration ceiling. An evidence-backed calibration could therefore address those Main 64 MiB assertions in isolation. It cannot address the renderer slope, which the governing evidence contract explicitly forbids raising above 16 MiB.

The grouped fixture catches over-report some assertion names as false after a later RSS check throws. This synthesis does not rely on those grouped labels. The raw measurements establish that the 64 MiB digest/length and renderer 64 MiB bound passed, that the Main 128 MiB slope passed, and that the renderer 128 MiB slope failed. Reporting precision may be maintained later, but it cannot change the raw failed canary.

## Why no correction/rerun is selected

No presently evidenced, permissible single correction rescues the conjunctive packaged gate:

| Candidate correction | Could affect | Cannot affect | Disposition |
| --- | --- | --- | --- |
| Hold app lifetime through atomic persistence | Canonical result publication and intended failed exit | Cancellation, RSS, plugin evaluation | Legitimate maintenance; irrelevant to feasibility and no rerun predecessor. |
| Correct development resource root | Linux development plugin fetch | Packaged plugin, cancellation, RSS | Development-only fixture correction; non-decisive. |
| Apply legitimate browser-build environment replacement to the prepared real plugin | Immediate `process is not defined` failure | Cancellation and RSS | Potential fixture-preparation correction; insufficient alone. |
| Split grouped catches / persist exact plugin counters | Reporting precision | Raw counters, raw slopes, runtime behavior | Observability maintenance only. |
| Calibrate Main 64 MiB threshold while staying below 64 MiB | Main 64 MiB assertion | Renderer hard slope, cancellation, plugin | Permitted in isolation but cannot rescue M0. |
| Raise, average away, reorder away, or discard the renderer slope | Would relabel RSS failure | Preserving the locked canary | Forbidden gate weakening. |
| Accept only response `cancel()`/upstream close, add a test-only manual signal, or explicitly call renderer `reader.cancel()` to manufacture the counter | Would relabel or manufacture cancellation evidence | RSS and plugin; frozen cancellation truth condition | Forbidden without an evidenced production-equivalent wiring defect; none is supplied. |
| Replace the real plugin with a toy module, expose Node globals, broaden CSP/privileges/sessions, buffer bodies, or use renderer HTTP(S) fallback | Could bypass a symptom | Security and representativeness; RSS/cancellation | Forbidden architecture/gate weakening. |

Combining unrelated finalization, plugin, cancellation, and measurement changes under the label of one fixture correction would evade the Plan's bounded decision rule. A hypothetical future supported-API design is not disproved, but it belongs to a new architecture decision, not to speculative work inside the exhausted Plan 063 M0 gate.

## Uncertainties retained without changing the result

- No runner read canonical result JSON. Linux packaged reached rename start; Linux development and Windows packaged ended at temporary-write start. The complete temp files prove retained bytes, not normal atomic publication.
- The lifecycle evidence strongly supports default last-window exit, but the exact internal Electron quit event was not directly recorded. Confirming that mechanism would improve fixture ergonomics, not change the behavior payloads.
- The workflows evaluated a synthesized PR merge commit rather than a head-only checkout. The reviewed materials identify no M0-relevant merge drift, but this qualification remains part of the evidence scope.
- The roughly 25 ms RSS samplers can miss peaks; they do not explain away or manufacture the broad body-correlated increases repeated across three executions. No matched control or reversed transfer order was supplied, but the locked M0 canary intentionally measures the packaged process as experienced.
- Incoming `Request.signal` did not abort even though response cancellation reached upstream and cleanup completed. The exact Electron semantic contract remains uncertain, so STOP does not depend on resolving it.
- Exact packaged `realPluginHits` and dependency-hit counts were not persisted. Five custom-scheme module hits and the custom-scheme stack location prove routing/evaluation progress, while the immediate `process` failure remains most likely a preparation defect.

## Required next action and production authorization

1. Record M0 as **failed / ARCHITECTURE STOP** for Plan 063's custom-scheme migration.
2. Keep all production renderer routing changes frozen. **M1, M2, M3, M4, M5, M6, and M7 are not authorized.**
3. Do not authorize another Plan 063 feasibility rerun solely to obtain canonical rename, refine grouped reporting, correct the development resource root, or repair plugin preparation. Those changes do not address the decisive RSS evidence.
4. Preserve the exact run, merge-ref qualification, artifact identity, PID-scoped temp results, cancellation counters, and raw RSS samples in the living Plan records. Do not mark partial subtests or parseable temp payloads as M0 PASS.
5. If the product still requires a Tearoff pool-starvation solution, open a separate Plan B architecture decision for local HTTP/2 over TLS. Do not implement Plan B inside Plan 063 and do not restore private Request/Response IPC framing, renderer HTTP/1.1 fallback, buffering, broadened privileges/session access, or weakened CSP/cancellation/RSS conditions.
6. Treat finalization, reporting, development-resource-root, and plugin-preparation changes only as separately authorized fixture maintenance for diagnostic reuse. None reopens or changes this Architecture STOP.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** governing decision boundary, exact run/revision/artifact scope, competing classifications, canonical/temp distinction, cancellation counters, raw RSS values and limits, plugin attribution, final classification, and next action are stated here.
- [x] **Tradeoffs and uncertainties explicit:** PASS versus negative evidence, strong but indirect last-window inference, merge-ref scope, sampler limits, `Request.signal` semantic tension, Main calibration versus locked renderer slope, and plugin preparation versus scheme/CSP capability are separated.
- [x] **Acceptance criteria addressed:** atomic publication, conjunctive assertions, cancellation, 64 MiB bound/calibration, locked 128 MiB slope, real plugin/CSP/session/security behavior, cleanup, one-correction boundary, STOP condition, and M1-M7 authorization are each dispositioned without weakening a truth condition.
- [x] **No implementation details leaked outside assigned scope:** this synthesis implements no fixture, test, workflow, production routing, Server/auth, package, or plan change; its only output is this decision handoff.
- [x] **Human-review quality / honest, thorough, non-marketing:** it reconciles rather than concatenates R/S/T, narrows claims beyond the evidence, does not promote temp JSON to canonical acceptance, does not demand a no-information rerun, and rests STOP on one replicated falsifiable locked metric.
