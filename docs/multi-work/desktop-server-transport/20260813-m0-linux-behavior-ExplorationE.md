# Exploration E: M0 Linux behavior failure disposition and evidence-preserving rerun

**Task node:** Plan 063 M0 / second Linux development runtime failure
**Exploration date:** 2026-08-13
**External revision:** PR #163 head `88e4c693ef5bfa0a8525bac61fd51cb184efc01d`
**External run:** GitHub Actions run `31624242438`, job `94206416048`
**Disposition:** **CONTINUE-EVIDENCE only.** Production routing remains blocked. Make no behavior correction yet and do not declare custom-scheme architecture STOP from the incomplete evidence. First make one evidence-preserving rerun that executes development and packaged modes independently and uploads the raw result JSON and stdout/stderr even when development fails. After that rerun, either identify one concrete fixture defect and permit exactly one narrow correction, or apply Plan 063's architecture STOP without weakening a gate.

## Evidence boundary

The Linux runner reached the real Electron 42.4.1 development fixture after the previously reviewed hosted-runner `--no-sandbox` launch exception. The runner read a real development result, but validation failed. The reported failures include:

- `response.cancel.invokedOnce` and `response.cancel.reachesUpstream`;
- cancellation diagnostics including `requestSignalAborts`;
- the 64 MiB Main/renderer RSS bounds and the 128 MiB non-linear Main/renderer bounds;
- `subresource.dynamicModule.realPlugin` and `subresource.dynamicModule.dependenciesStayCustomScheme`;
- the `customSchemeModuleHits` evidence invariant.

The packaged fixture did not run because `m0:custom-scheme:gate` is `development && packaged`. The development failure stopped the sequence. The failure artifact also contains no `.m0-results` files because that directory is hidden and `actions/upload-artifact` used its default `include-hidden-files: false`. Consequently the raw JSON, raw 25 ms RSS traces, exact assertion `details`, counters, and captured renderer/Main errors are unavailable from this run. The job log's validator summary is sufficient to reject M0, but not sufficient to distinguish an Electron capability failure from a fixture/assertion defect or to exercise the one allowed evidence-backed RSS calibration.

The inspected fixture contract is materially strict in the relevant areas: it requires renderer abort to abort the protocol `Request.signal`, invoke the returned response stream's `cancel()` exactly once, close the fake upstream exactly once, and return active requests to zero; it requires a real prepared plugin and its dependency wrappers to load through `cradle-server://local` under the representative CSP; and it validates raw trace maxima against the locked RSS bounds. Those requirements match Plan 063 and must not be converted into skips or weaker substitutes.

## Failure classification

| Failure area | Current classification | Why it is not yet a final architecture verdict | Decision after preserved evidence |
| --- | --- | --- | --- |
| Development failure prevents packaged execution | **Definite harness/orchestration defect** | Plan 063 requires both modes as evidence. A failing development step must not erase the packaged observation. This says nothing about custom-scheme capability. | Run development and packaged as separate failing steps in the same job; packaged uses `if: always()` and remains a hard gate. |
| `.m0-results` omitted from artifact | **Definite evidence-fixture defect** | The files existed under a hidden directory, but the uploader excluded hidden files by default. This is an observability failure, not a product behavior failure. | Upload on `always()` with `include-hidden-files: true`; retain JSON and both logs for both modes. |
| `response.cancel.invokedOnce`, `response.cancel.reachesUpstream`, `requestSignalAborts` | **Product capability failure unless a concrete fixture bug is shown; presently unresolved** | These are the architecture's mandatory end-to-end cancellation semantics, not optional diagnostics. The missing JSON/log prevents determining whether Electron failed to propagate renderer abort across `protocol.handle`, or whether the fixture miswired/observed the stream. | If a correct fixture shows renderer `AbortController.abort()` does not abort the protocol request, invoke response `cancel()` exactly once, and close upstream exactly once, **ARCHITECTURE-STOP**. A correction is allowed only for an evidenced fixture wiring/measurement defect. Do not add `reader.cancel()`, IPC, or another manual signal merely to satisfy the assertion. |
| 64 MiB Main/renderer RSS bounds | **Threshold calibration candidate, otherwise product/streaming failure** | The initial `<48 MiB` per-process delta is explicitly provisional. The lost raw samples prevent deciding whether each delta is below the absolute 64 MiB cap or whether the trace includes startup/JIT noise. | One calibration is allowed only from the raw trace, only if each per-process delta remains **below 64 MiB**. A `>=64 MiB` delta, body-sized buffering, or absent/untrustworthy samples is not calibratable and leads to STOP. |
| 128 MiB Main/renderer non-linear bounds | **Threshold/measurement candidate only if the locked slope already holds; otherwise product failure** | Exact 64 and 128 MiB baselines, peaks, and samples are missing. The failure label alone cannot distinguish sampler timing from linear body growth. | The 64-to-128 MiB slope must remain **below 16 MiB**. This slope cannot be raised. Linear growth after one evidence-backed correction is **ARCHITECTURE-STOP**. |
| Real plugin assertion | **Unknown: fixture asset/registry/CSP error or product custom-scheme module failure** | The simple module result, exact import exception, route hits, prepared manifest, and CSP console error were not preserved. A failed activation contract may be a fixture defect; failure to load the real module through the custom scheme under CSP is a product feasibility failure. | Preserve the exact module URL/error, `realPluginHits`, dependency route hits, prepared manifest identity, and renderer CSP console output. Fix only a demonstrated preparation/fixture-contract error. If supported Electron APIs cannot load the real plugin shape without privilege or CSP weakening, **ARCHITECTURE-STOP**. |
| Dependency custom-scheme assertion and `customSchemeModuleHits` | **Unknown, coupled to the real-plugin failure** | A low hit count may be the downstream consequence of the root plugin import failing before dependency loads, or it may reveal HTTP(S)/bare-specifier escape. The missing counters and console error prevent attribution. | Keep the equality between handler hits and simple/plugin/dependency route hits. Any HTTP(S) fallback, bare dependency escape, or ticket fallback is a gate failure, not a fixture accommodation. |
| Packaged custom-scheme behavior | **Unknown / not executed** | There is no packaged process result at this revision. Plan 063's hard feasibility question therefore remains unanswered. | The evidence rerun must execute the exact ASAR-packaged unpacked artifact even when development fails. Apply the same assertions without skips. |

Passing GET/POST, first-byte response streaming, multipart, image, PDF, simple module, strict CSP declaration, or session isolation in the same development result, if present, cannot compensate for any failed required assertion. M0 is conjunctive: every named assertion must be true in development and packaged mode.

## Plan 063 STOP interpretation

This is the first post-sandbox run to reach the behavior gate. The earlier Linux failure and correction concerned GitHub's SUID sandbox launch environment; it did not attempt to correct cancellation, module, or RSS behavior. Therefore the current result is not by itself the plan's “second failed behavior verification after a reasonable correction.” However, it is also not permission for speculative implementation.

The only authorized next state is **CONTINUE-EVIDENCE**:

1. Correct the workflow's execution and artifact preservation only.
2. Rerun the unchanged behavior fixture at the exact revision and preserve both modes.
3. Attribute every failure from raw evidence.
4. If the evidence identifies a concrete harness/fixture defect, authorize **ONE-CORRECTION** scoped to that defect and rerun both modes once.
5. If the evidence instead shows a required custom-scheme behavior is unreliable with supported Electron 42.4.1 APIs, or the corrected verification fails again, declare **ARCHITECTURE-STOP**, leave production routing untouched, and open the separate local HTTP/2-over-TLS Plan B decision.

An evidence-only rerun does not consume the one reasonable behavior correction. Changing behavior before preserving this evidence would consume it without a defensible diagnosis and could conceal the architecture failure the gate exists to reveal.

## Minimal evidence-preservation change

The next workflow change should alter orchestration and upload only; it must not edit assertions, thresholds, protocol privileges, renderer preferences, fake-upstream semantics, CSP, session registration, or result truth conditions.

Use two independently observable runtime steps rather than the composite `m0:custom-scheme:gate` command:

```yaml
- name: Run development custom-scheme gate
  env:
    CRADLE_M0_NO_SANDBOX: '1'
  run: xvfb-run -a pnpm --filter @cradle/desktop m0:custom-scheme:dev

- name: Run packaged custom-scheme gate
  if: always()
  env:
    CRADLE_M0_NO_SANDBOX: '1'
  run: xvfb-run -a pnpm --filter @cradle/desktop m0:custom-scheme:packaged

- name: Upload M0 evidence
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: desktop-m0-custom-scheme-${{ github.run_id }}
    if-no-files-found: error
    include-hidden-files: true
    retention-days: 7
    path: |
      apps/desktop/.m0-results/**
      apps/desktop/release/m0/builder-effective-config.yaml
```

Do not use `continue-on-error`. GitHub Actions retains the failed development step as a job failure; `if: always()` only ensures the packaged observation and uploader still execute. The packaged command must build and launch the exact deterministic `release/m0/linux-unpacked/cradle-m0-gate` artifact. Upload should be `always()`, not merely `failure()`, so a mixed-mode result and the eventual passing baseline are both reviewable.

For each mode, the artifact must contain, when produced:

- `<mode>-linux-x64.json`, unchanged and unredacted except for the fixture's existing no-secret contract;
- `<mode>-linux-x64.stdout.log` and `<mode>-linux-x64.stderr.log`;
- every raw RSS sample already represented by `memory.trace64MiB.samples` and `memory.trace128MiB.samples`;
- assertion details and counters including `responseCancels`, `requestSignalAborts`, `upstreamCloses`, `activeRequests`, `cancelStreamChunks`, `customSchemeModuleHits`, `realPluginHits`, and dependency hits;
- launch evidence (`electronVersion`, `launch.noSandbox`, `launch.rendererSandbox`, platform/arch, mode, and packaged artifact path).

If the fixture exits before it can atomically write its final JSON, preserve a sibling diagnostic JSON or log containing the last complete assertion/counter/trace state in a later, separately reviewed observability correction; do not synthesize passed assertions. The existing compact-artifact rule remains: generated 64/128 MiB bodies are streamed and discarded and must never be uploaded.

## Gates that may not be weakened

The evidence rerun and any later single correction must retain all named assertions. In particular, it must not:

- change renderer abort proof into explicit `reader.cancel()`, tolerate zero/multiple response cancels, omit protocol `Request.signal` abortion, tolerate multiple/missing upstream closes, or accept leaked active requests;
- raise any per-process 64 MiB RSS delta to 64 MiB or more, raise the 64-to-128 MiB slope above 16 MiB, discard raw samples, accept body-proportional growth, or relabel a failed numeric gate as diagnostic-only on Linux;
- replace the repository's real plugin with a toy module, omit dependency-wrapper requests, accept bare/HTTP(S) dependency loads, enable `bypassCSP`, broaden the representative CSP, or introduce resource-ticket/HTTP(S) fallback;
- add `codeCache`, service-worker or extension privilege as an unmeasured workaround, broaden the exact five privileged-scheme flags, change the exact `cradle-server://local` authority, or accept ports/credentials;
- install the protocol handler in `persist:cradle-browser-*`, remove the renderer-side fetch/image denial probe, relax `partitionHits === 0`, disable `BrowserWindow` sandboxing, context isolation, disabled Node integration, or web security;
- use private Request/Response IPC, pull-credit framing, PTY-over-IPC, whole-body buffering/base64, product Chat/database changes, or a silent renderer HTTP/1.1 fallback.

## Acceptance outcome for this exploration

- **M0:** failed and still blocking production migration.
- **Harness/fixture status:** two definite evidence defects (sequencing and hidden-file upload); behavior-fixture correctness remains unresolved in cancellation/plugin/RSS areas.
- **Architecture status:** not yet stopped because decisive raw evidence was lost, but cancellation, plugin/custom-scheme, and linear/bound-exceeding RSS failures are direct STOP candidates rather than negotiable assertions.
- **Next authorized action:** evidence-preservation-only workflow correction and rerun of unchanged development plus packaged assertions.
- **Next decision:** `ONE-CORRECTION` only for a concrete defect proven by the preserved evidence; otherwise `ARCHITECTURE-STOP`. A second failure after that reasonable correction is STOP.

## Handoff Quality Gate

- [x] **File is self-contained / zero external context:** identifies the exact revision/run/job, observed failure classes, missing evidence, Plan 063 disposition, and the complete next-action boundary.
- [x] **Tradeoffs and uncertainties explicit:** separates definite workflow defects, provisional-but-bounded RSS calibration, possible fixture defects, product capability failures, and unexecuted packaged behavior without claiming unavailable raw values.
- [x] **Acceptance criteria addressed:** gives an explicit `CONTINUE-EVIDENCE` verdict, the transition rules to `ONE-CORRECTION` or `ARCHITECTURE-STOP`, an execution/upload design that survives development failure, and the non-weakening constraints.
- [x] **No implementation details leaked outside assigned scope:** this exploration performs no implementation, changes no workflow or fixture, and its formal output is this handoff document only.
- [x] **Human-review quality, honest/thorough/no marketing:** refuses to treat validator summaries as sufficient diagnosis, refuses to promote partial assertion success, and preserves Plan 063's hard feasibility and security boundaries.
