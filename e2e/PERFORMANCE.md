# E2E Interaction Performance

This document defines how Cradle measures user action-to-response latency across
the maintained Cucumber Web, Fabric two-node, and Fabric Mobile iOS E2E paths.
The report is diagnostic evidence: it identifies expensive journeys and supports
before/after review, but it is not a latency gate because shared-runner load can
move single E2E samples materially.

| Area | Owner | Responsibility |
| --- | --- | --- |
| Cucumber boundary | [`scripts/performance-report.cjs`](scripts/performance-report.cjs) | Reconstructs each Gherkin action and its consecutive observable outcomes from `cucumber-messages.ndjson`. |
| Fabric boundary | [`src/fabric/fabric-two-node.spec.ts`](src/fabric/fabric-two-node.spec.ts) | Marks Web and Mobile action-to-response operations as Playwright interaction steps. |
| Fabric reporter | [`scripts/playwright-performance-reporter.cjs`](scripts/playwright-performance-reporter.cjs) | Converts marked Playwright steps, including failures, into the shared report model. |
| Cucumber integration | [`scripts/summarize-run.cjs`](scripts/summarize-run.cjs) | Writes performance artifacts beside each pass/fail summary. |
| Human report | `e2e-performance.md` | Shows response bands and the 30 slowest interaction samples. |
| Machine report | `e2e-performance.json` | Preserves every sample, surface, action aggregate, thresholds, and optional baseline comparison. |

## Measurement Contract

The suites use their native semantic seams rather than attempting to infer a
response from raw click events:

- Cucumber starts at a Gherkin `Action` step and includes every consecutive
  `Outcome` step. The next `Action` or `Context` closes the boundary.
- Fabric Web wraps a user operation and its rendered, persisted, remote, or
  streamed result in `[interaction:fabric-web]` Playwright steps.
- Fabric Mobile wraps every invoked Maestro flow in
  `[interaction:mobile-ios]`. Each flow ends at its final visible assertion, so
  app launch and navigation needed for that action are included but simulator,
  app build, server, and topology startup are excluded.

These are the authored user interaction boundaries in the E2E contracts. A
single boundary may contain prerequisite taps or text entry when those commands
do not have an independently asserted product response.

The report deliberately:

- excludes hooks, fixtures, application build/startup, topology startup, and
  Cucumber `Context` setup;
- uses only the latest retry attempt so a recovered retry is not mixed with its failed predecessor;
- retains executed failures so timeout-heavy paths remain visible, while excluding skipped actions that never occurred;
- groups repeated action definitions by stable `@CRADLE-*` scenario ID for baseline comparison;
- labels samples by `web`, `fabric-web`, or `mobile-ios` surface;
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

Build shared packages first. Run the desired suite; each command writes its own
performance report without combining samples from different hosts or runtime
lanes:

```bash
pnpm --filter @cradle/plugin-sdk build
pnpm --filter "./plugins/*" build
pnpm exec cucumber-js --config e2e/cucumber.mjs \
  --tags '@runtime-none' \
  --format message:e2e/artifacts/cucumber-messages.ndjson \
  --format progress-bar
pnpm e2e:performance:report

# Real relayd, two independent Servers, and Fabric Web UI
pnpm e2e:fabric

# The same Fabric topology plus the native iOS app and Maestro
pnpm e2e:fabric:mobile:ios
```

Cucumber writes `e2e/artifacts/e2e-performance.{json,md}`. Both Fabric commands
write `e2e/artifacts/fabric-results/performance/e2e-performance.{json,md}`;
Mobile also retains per-flow Maestro diagnostics under
`e2e/artifacts/mobile-fabric/`.

To compare a later run against a preserved report:

```bash
E2E_PERFORMANCE_BASELINE=e2e/artifacts/baseline/e2e-performance.json \
  pnpm e2e:performance:report

E2E_FABRIC_PERFORMANCE_BASELINE=/path/to/fabric/e2e-performance.json \
  pnpm e2e:fabric
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

The report measures the full tested contract, not browser or native main-thread
work alone. A slow sample may include API, database, Git, PTY, relay, runtime
provider, polling, app navigation, or rendering time. Use Playwright traces,
Maestro diagnostics, and server/runtime logs to attribute a high-ranked
interaction before changing product code.

Actions that intentionally release simulator gates or mutate files from an external process still appear when authored as Gherkin `Action` steps. They are retained because they describe an observable journey boundary, but should not be interpreted as direct UI latency. Parallel workers also share host resources; compare within the same lane and worker configuration.

Fabric reports explicit interaction steps rather than every Playwright locator
call. Mobile reports one sample per Maestro flow rather than each YAML command.
That granularity keeps the end boundary tied to an asserted product response;
recording a tap or text entry with no independent outcome would measure driver
execution rather than user-perceived response time.

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
| Cucumber interaction report | One parser, one focused test file, two artifacts per CI lane, and about 32-45 KB per measured local lane. Report generation measured 50 ms wall time for 120 steps. | Informational comparisons may fluctuate with runner load; no runtime overhead and no CI failure gate. Failed interactions remain visible. | All maintained Cucumber scenarios across Claude, Codex, and runtime-none lanes; CI summary and artifact uploads. | Ship: broad observability gain with negligible run cost. |
| Fabric interaction report | One Playwright reporter, one focused test file, and explicit interaction steps at the existing Web and Mobile orchestration boundaries. | Step titles are a report contract. Renaming one without updating its baseline creates a new series; there is no product runtime overhead. | Both maintained Fabric scenarios, including two-node Web and native Mobile iOS. | Ship: the same artifact schema now covers all maintained E2E surfaces. |
| PR evidence check | Five required PR fields, a small body validator, and one workflow job. | Documentation-only and generated/dependency-only pull requests still need concise evidence or an explicit not-applicable rationale. The check validates presence, not the quality of measurements. | Every pull request and the repository PR template; no application runtime effect. | Ship: review cost is small and performance tradeoffs cannot be omitted silently. |
| Replace Agent save sleep | One E2E assertion changed. | Depends on the create view disappearing only after successful mutation; that is the user-visible transition already owned by the screen. It can expose a real regression instead of waiting blindly. | `CRADLE-AGENT-ID-001`; no product runtime code. | Ship: removes 1.95 s of false latency and lowers flake risk. |
| Remove search debounce sleep | One shared page-object line removed. | Downstream result locators must auto-wait; all current callers already assert or click a specific result. A missing result now consumes its owning assertion timeout rather than an unconditional delay. | Settings, Provider, Agent Identity, and Search E2E journeys; no product runtime code. | Ship: removes a fixed test tax without weakening response assertions. |
| Keep Fabric loopback traffic off host proxies | One child-process environment merge adds loopback hosts to both `NO_PROXY` spellings. | A developer can no longer intentionally proxy Fabric loopback calls through `http_proxy`; non-loopback traffic and the parent shell remain unchanged. | Processes started by the Fabric topology only, including simulated Codex endpoints and local Servers. | Ship: local topology semantics require direct loopback traffic and the change removes environment-dependent `502` failures. |
| Wait for Fabric process groups before cleanup | Two small process-group helpers replace the parent-only exit wait. The existing five-second graceful shutdown budget is retained before `SIGKILL`. | A process that ignores both signals now fails teardown explicitly instead of leaving data behind. POSIX detached process-group semantics were already required by this harness. | Fabric topology teardown on Web and Mobile CI; no product runtime or user data. | Ship: the first validation passed 33 interactions but ended with `ENOTEMPTY`; the repeat passed with one Web scenario and one expected Mobile skip and left no new topology directory. |
| Make native iOS build phases space-safe | One quoted React Native script invocation in the app project and one strict post-`pod install` patch for Expo Constants 57.0.16. | The Expo patch is intentionally version-coupled and fails if its generated phase no longer matches exactly once. CocoaPods still emits a non-fatal path-splitting warning from an unrelated hook. | All iOS app builds for the React Native phase; the Expo patch is limited to the Mobile Fabric E2E runner. No product JavaScript changes. | Ship: Cradle-managed worktrees contain spaces, and without both fixes the Release bundle either fails to build or launches without its manifest. Remove the generated-phase patch when Expo quotes both path uses upstream. |

The remaining runtime-none investigation queue is `CRADLE-KANBAN-002` Issue deletion (`1,237.534 ms`), `CRADLE-SETTINGS-001` open Settings (`1,096.490 ms`), and `CRADLE-KANBAN-001` open Kanban (`1,023.557 ms`). These were not changed because a single end-to-end sample does not attribute the delay to API, cache invalidation, or render work; use their traces before choosing a product optimization.

`CRADLE-CHAT-001` was also executed twice through the real Claude Agent SDK. Both runs accepted the request and displayed runtime timing state (`TTFB` 160 ms and 130 ms), but failed to project the expected assistant text within 30 seconds. The performance reports retained the failed send interactions at `31,027.823 ms` and `31,128.044 ms` in the `severe` band. This reproducible runtime failure is outside the two harness wait changes and is not presented as a successful performance result.

### Fabric Web

The final two-node Web run passed all 33 measured interactions. Its P50 was
`397 ms`, P95 was `1.898 s`, and maximum was `1.917 s`. The 11 flow-breaking
samples cover Node pairing propagation, first Work creation, remote Chat, and
approval, which measured about `1.0-1.9 s`. These paths cross process,
persistence, relay, or runtime boundaries; the report identifies them for trace
attribution but does not justify a product change from one sample.

An earlier run retained a failed remote Chat sample at `60.747 s`. The Codex
runtime received five `502 Bad Gateway` responses while the simulator ledger
recorded no request. The host exported `http_proxy` and `https_proxy` for
`127.0.0.1:6152` without `NO_PROXY`, so child processes sent the loopback model
endpoint through that proxy. The Fabric topology now merges loopback hosts into
both `NO_PROXY` and `no_proxy`; validation from a shell with no pre-existing
bypass completed with one scenario passed and the Mobile scenario skipped.
This was an E2E environment failure, not a 60-second application response.

### Fabric Mobile iOS

The native run passed all five Mobile interactions and the 17 Web interactions
that prepared and mutated its two-node topology. The combined report recorded
22/22 passes with P50 `491 ms`, P95 `30.930 s`, and maximum `50.431 s`. Isolating
the Mobile surface gives P50 `15.685 s`, P95/max `50.431 s`:

| Mobile action | Duration | Band |
| --- | ---: | --- |
| Switch Nodes, send Chat, and render the streamed response | 50.431 s | `severe` |
| Enroll the Controller and show its pending state | 30.930 s | `severe` |
| Select a Node and show only its Workspaces | 15.685 s | `severe` |
| Refresh after grant revocation and remove that Node | 15.507 s | `severe` |
| Refresh after Controller revocation and show access revoked | 13.196 s | `severe` |

Each Mobile sample is one Maestro flow and includes a cold app launch plus the
navigation required to reach its asserted response. The data therefore exposes
slow end-to-end journeys, especially Chat and enrollment, but cannot distinguish
native startup, driver overhead, navigation, network propagation, and final
rendering. The next measurement improvement is to add independently asserted
intermediate outcomes before changing product code; optimizing against these
whole-flow numbers alone risks moving test overhead rather than user latency.

The first native attempt failed after `80.613 s` because the Release app exited
about three seconds after launch. Its bundle lacked the Expo Constants manifest:
Expo's generated phase split the worktree path at `Application Support`, then
its script silently skipped generation after an unquoted `basename`. Quoting
the React Native phase and normalizing the generated Expo phase produced a
launchable bundle and the successful five-flow sample above. The build,
simulator creation, topology startup, and separate `pod install` phase remain
outside all reported interaction durations.
