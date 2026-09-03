# E2E Interaction Performance

This document defines how Cradle measures user action-to-response latency in the existing Cucumber E2E suite. The report is diagnostic evidence: it identifies expensive journeys and supports before/after review, but it is not a pass/fail gate because shared-runner load can move single E2E samples materially.

| Area              | Owner                                                              | Responsibility                                                                          |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Raw events        | `cucumber-messages.ndjson`                                         | Records test-case, retry, step status, and nanosecond duration envelopes.               |
| Interaction model | [`scripts/performance-report.cjs`](scripts/performance-report.cjs) | Reconstructs every action and its observable response boundary.                         |
| Run integration   | [`scripts/summarize-run.cjs`](scripts/summarize-run.cjs)           | Writes performance artifacts beside the pass/fail summary.                              |
| Human report      | `e2e-performance.md`                                               | Shows response bands and the 30 slowest interaction samples.                            |
| Machine report    | `e2e-performance.json`                                             | Preserves every sample, action aggregate, thresholds, and optional baseline comparison. |

## Measurement Contract

An interaction starts at a Gherkin `Action` step. Its duration includes that step and every consecutive `Outcome` step, ending only after the last expected user-visible result has been verified. The next `Action` or `Context` starts a new boundary. This matches the suite's existing View/page-object seam: an action drives the real browser, while outcomes wait for rendered, persisted, or streamed state.

The report deliberately:

- excludes `Before`/`After` hooks, application build/startup, and `Context` setup;
- uses only the latest retry attempt so a recovered retry is not mixed with its failed predecessor;
- retains executed failures so timeout-heavy paths remain visible, while excluding skipped actions that never occurred;
- groups repeated action definitions by stable `@CRADLE-*` scenario ID for baseline comparison;
- records every interaction in milliseconds to three decimal places and calculates nearest-rank P50/P95 values.

Response bands use established human-response thresholds:

| Band            |     Duration | Interpretation                                                      |
| --------------- | -----------: | ------------------------------------------------------------------- |
| `instant`       |    `<100 ms` | The response reads as immediate.                                    |
| `perceptible`   | `100 ms-1 s` | Delay is visible but normally preserves flow.                       |
| `flow-breaking` |     `1-10 s` | The wait interrupts repeated work and warrants investigation.       |
| `severe`        |     `>=10 s` | Attention is likely lost or explicit progress feedback is required. |

The bands prioritize investigation; they are not performance budgets. Product-specific budgets should be added only after multiple controlled samples establish stable variance.

## Run And Compare

Build shared packages first, then capture the Cucumber message stream from the desired runtime lane:

```bash
pnpm --filter @cradle/plugin-sdk build
pnpm --filter "./plugins/*" build
pnpm exec cucumber-js --config e2e/cucumber.mjs \
  --tags '@runtime-none' \
  --format message:e2e/artifacts/cucumber-messages.ndjson \
  --format progress-bar
pnpm e2e:performance:report
```

To compare a later run against a preserved report:

```bash
E2E_PERFORMANCE_BASELINE=e2e/artifacts/baseline/e2e-performance.json \
  pnpm e2e:performance:report
```

The comparison matches the stable scenario ID and exact action text. It reports improvements and regressions, but remains informational because one process run cannot separate application changes from CPU, disk, browser, and CI contention. Use the same tag filter, worker count, production build mode, host, and runtime fixtures on both sides.

## Change Review

Every performance-sensitive change must record these fields in its pull request:

| Field                | Required evidence                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Baseline and current | Same interaction definition, sample count, P50/P95 where repeated, and absolute/percentage delta. |
| Measurement scope    | Scenario IDs, runtime lane, worker count, build mode, and whether model streaming is included.    |
| Implementation cost  | Files and owners changed, added runtime or maintenance complexity, and operational dependencies.  |
| Side effects         | Correctness, memory, CPU, network, caching, flake risk, and observability tradeoffs.              |
| Impact radius        | User journeys, namespaces, runtime providers, platforms, and CI lanes affected.                   |
| Decision             | Ship, revise, or reject, including why the measured gain justifies the tradeoff.                  |

## Limits

The report measures the full tested contract, not browser main-thread work alone. A slow sample may include API, database, Git, PTY, runtime provider, polling, or rendering time. Use the Playwright trace and server/runtime logs to attribute a high-ranked interaction before changing product code.

Actions that intentionally release simulator gates or mutate files from an external process still appear when authored as Gherkin `Action` steps. They are retained because they describe an observable journey boundary, but should not be interpreted as direct UI latency. Parallel workers also share host resources; compare within the same lane and worker configuration.

Dedicated Fabric Playwright and Mobile Maestro suites do not emit Cucumber messages and are therefore outside this report. Their named `test.step` and Maestro flow timings remain available in their native artifacts; a cross-run comparison requires a separate owner-specific contract rather than projecting them into Cucumber actions.

## Validation Record: 2026-09-04

The implementation was validated on macOS arm64 with serial Cucumber execution against production Web builds. Both `@runtime-none` runs covered the same 10 scenarios, 120 steps, and 39 user interactions. Build and managed Server startup time were excluded.

| Metric | Baseline | Current | Delta |
| --- | ---: | ---: | ---: |
| Suite execution | 43.417 s | 41.702 s | -1.715 s (-3.95%) |
| Interaction P50 | 160.696 ms | 160.287 ms | -0.409 ms (-0.25%) |
| Interaction P95 | 1,198.870 ms | 1,096.490 ms | -102.380 ms (-8.54%) |
| Maximum interaction | 2,109.157 ms | 1,237.534 ms | -871.623 ms (-41.33%) |
| Flow-breaking interactions | 5 | 3 | -2 |
| Severe interactions | 0 | 0 | 0 |

The only isolated, deterministic gain is `CRADLE-AGENT-ID-001` Agent save: `2,109.157 ms` to `158.670 ms`, a `1,950.487 ms` (`92.48%`) reduction. The removed `2 s` sleep did not represent application work; replacing it with the create view's disappearance preserves the response boundary and makes the measured value reflect the actual mutation and render.

The search helper's removed `500 ms` sleep affects Settings, Provider, Agent Identity, and Search journeys. `CRADLE-SETTINGS-001` open Settings measured `1,198.870 ms` before and `1,096.490 ms` after. The observed `102.380 ms` reduction is smaller than the removed delay because the underlying render varied between single samples, so it is evidence that the fixed floor is gone, not a claimed product speedup.

| Change | Implementation cost | Side effects and risk | Impact radius | Decision |
| --- | --- | --- | --- | --- |
| Cucumber interaction report | One parser, one focused test file, two artifacts per CI lane, and about 32-45 KB per measured local lane. Report generation measured 50 ms wall time for 120 steps. | Informational comparisons may fluctuate with runner load; no runtime overhead and no CI failure gate. Failed interactions remain visible. | All 66 Cucumber scenarios across Claude, Codex, and runtime-none lanes; CI summary and artifact uploads. | Ship: broad observability gain with negligible run cost. |
| Replace Agent save sleep | One E2E assertion changed. | Depends on the create view disappearing only after successful mutation; that is the user-visible transition already owned by the screen. It can expose a real regression instead of waiting blindly. | `CRADLE-AGENT-ID-001`; no product runtime code. | Ship: removes 1.95 s of false latency and lowers flake risk. |
| Remove search debounce sleep | One shared page-object line removed. | Downstream result locators must auto-wait; all current callers already assert or click a specific result. A missing result now consumes its owning assertion timeout rather than an unconditional delay. | Settings, Provider, Agent Identity, and Search E2E journeys; no product runtime code. | Ship: removes a fixed test tax without weakening response assertions. |

The remaining runtime-none investigation queue is `CRADLE-KANBAN-002` Issue deletion (`1,237.534 ms`), `CRADLE-SETTINGS-001` open Settings (`1,096.490 ms`), and `CRADLE-KANBAN-001` open Kanban (`1,023.557 ms`). These were not changed because a single end-to-end sample does not attribute the delay to API, cache invalidation, or render work; use their traces before choosing a product optimization.

`CRADLE-CHAT-001` was also executed twice through the real Claude Agent SDK. Both runs accepted the request and displayed runtime timing state (`TTFB` 160 ms and 130 ms), but failed to project the expected assistant text within 30 seconds. The performance reports retained the failed send interactions at `31,027.823 ms` and `31,128.044 ms` in the `severe` band. This reproducible runtime failure is outside the two harness wait changes and is not presented as a successful performance result.
