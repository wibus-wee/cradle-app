# E2E Testing Guide

This file applies to everything under `e2e/`.

## Stack

- `@cucumber/cucumber` + Playwright Chromium (web E2E)
- LLM wire substitute: **`@cradle/model-api-simulator` only** (`autoRespond: 'probes-only'`)
- Runtimes under test: **real Claude Agent Provider** and **real Codex** (app-server)
- **Never** set `CRADLE_MOCK_LLM_URL` and **never** restore `MockLlmServer`

## Commands

```bash
# Prefer Node >= 22.15 for zstd (e.g. nvm use 22.22.2)
pnpm --filter @cradle/plugin-sdk build
pnpm --filter "./plugins/*" build
pnpm e2e:check
# Optional: provision native Codex app-server for Codex essence scenarios
pnpm --filter @cradle/desktop sync:codex-runtime
pnpm exec playwright install chromium-headless-shell
pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@P0"
pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@P0 or @P1"
pnpm e2e:performance:report
pnpm e2e:fabric
pnpm e2e:fabric:mobile:ios
```

`pnpm e2e:check` enforces two contracts: the suite inventory (scenario tags,
IDs, README indexes, module disposition) and **tool coverage** — every canonical
`CradleToolKind` must have a live journey or an explicit accepted-gap reason
(`e2e/scripts/check-tool-coverage.mts`).

`CRADLE_E2E_NODE` may point the managed server at a repository-compatible Node
binary. `CRADLE_E2E_BROWSER_PATH` may point local runs at an existing Chromium
executable; CI installs the Playwright-pinned browser instead.
`CRADLE_E2E_PARALLEL` sets the Cucumber worker count (default `1`). Each worker
boots its own managed server + web stack; the chat settlement timeout scales with
the worker count to absorb shared-machine load. CI keeps `@runtime-codex` serial
because its scenarios exercise several native streams on one app-server host;
`@runtime-claude` and `@runtime-none` lanes may use multiple workers.

## CI gate

- PR smoke (`e2e-smoke.yml`) runs `@P0` when **critical paths** change
  (`e2e/**`, `packages/model-api-simulator/**`, `apps/web/**`, `apps/server/**`, …)
  **or** when the `e2e` label is present (force / keep running).
- Always checks out the **PR head**; only the `@runtime-codex` lane provisions Codex via `sync:codex-runtime`.
- Both workflows run `pnpm e2e:check` before expensive builds and browser setup.
- PR full E2E: add the `e2e-full` label to a PR. The existing PR workflow then
  runs the exact PR head with `@P0 or @P1`; while the label remains, later pushes
  continue to run the full suite. Failures are commented on the PR with artifacts.
- Daily (`e2e-daily.yml`) defaults to **`@P0 or @P1`** (full active priority suite).
  Failures open a GitHub Issue labeled `daily-e2e-failure` assigned to `wibus-wee`.
- Tag model:
  - `@P0` — smoke / must-never-break core path
  - `@P1` — important journeys (daily with P0)
  - `@essence` — quality marker on every live scenario (not a CI selector)
  - `@runtime-claude` / `@runtime-codex` / `@runtime-none` — exactly one execution lane
  - `@serial` — keep native host traffic serial inside that lane
- **No `@wip`.** Unfinished scenarios do not land on the branch. Fix them or do not commit them.

## Quality bar（精）

Every scenario must be a real multi-link user journey. Prefer depth over count.
Shallow “page is visible” checks belong in unit/component tests, not here.

If the simulator cannot express a needed wire behaviour, **extend the simulator** —
do not invent a parallel mock LLM.

## Authoring Rules

- Write `.feature` files in Chinese.
- Tags: `@cradle`, `@P0`/`@P1`, `@essence`, one `@runtime-*` owner, plus stable IDs like `@CRADLE-CHAT-001`.
  Every live scenario must carry a priority (`@P0` or `@P1`) **and** `@essence`.
- Put reusable setup in `e2e/src/support/` (simulator, providers, scenarios, pages).
- Keep step definitions thin; use page objects under `e2e/src/support/pages/`.
- Prefer `data-testid` selectors first.
- After LLM turns settle, prefer `Simulator 脚本化交换应全部耗尽` (`assertExhausted`).

## Failure evidence (local + CI)

On scenario failure, `e2e/artifacts/scenarios/<slug>-<n>/` contains:

| File | Purpose |
|------|---------|
| `failure.webm` | 1:1 Chromium recording (CI upload; not embedded in Cucumber HTML) |
| `failure.png` | Full-page screenshot at the failing step |
| `trace.zip` | Playwright trace — `npx playwright show-trace path/to/trace.zip` |
| `console.log` | Renderer console + model-api-simulator request ledger |

Root `e2e/artifacts/ARTIFACTS.md` and `failure-index.json` document the bundle.
Daily/smoke CI uploads all of the above and links them from the failure Issue / PR comment.
Run summaries are parsed from `cucumber-messages.ndjson` by
`e2e/scripts/summarize-run.cjs`; workflows must not carry their own report parser.

## Interaction performance

Every Cucumber, Fabric two-node, and Fabric Mobile iOS CI lane writes
`e2e-performance.json` and `e2e-performance.md`. Cucumber interactions begin at
an `Action` and include following `Outcome` steps. Fabric interactions are
explicit Playwright steps with a required response description for Web; every
Mobile `launchApp`, `tapOn`, and `inputText` command must carry a `perf-action`
or same-operation
`perf-continuation` label paired with a `perf-response` visible assertion.
Hooks, build/simulator startup, topology setup, unselected Mobile branches, and
Cucumber `Context` steps are excluded.
See [`PERFORMANCE.md`](PERFORMANCE.md) for the measurement contract, artifact
paths, response bands, baseline comparison, limitations, and the
performance/impact review record required for every change.

## Simulator usage

- `configureClaudeAgentChat` — Anthropic Messages + real Claude Agent
- `configureCodexChat` — OpenAI Responses + real Codex app-server
- Standard runtime was removed from the new-chat catalog; do not add a standard chat configuration path
- Scenario builders live in `e2e/src/support/scenarios/` (`anthropic.ts`, `openai.ts`, `tool-matrix.ts`)
- Stream/tool vocabulary helpers live in `support/helpers/stream-vocabulary-scenario.ts`; Codex tool-loop helpers in `support/helpers/codex-tool-scenario.ts`
- Just-in-time enqueue for multi-turn Claude so intermediate SDK calls cannot steal FIFO
- Page objects live in `e2e/src/support/pages/` — keep step defs thin
- Cradle wire fixtures / conformance: `packages/model-api-simulator/fixtures/cradle/`

## Scenario Scope

- `P0`: smoke — onboarding, core chat/queue recovery, Claude approval, Codex rollback,
  Work isolation, and Issue delegation/rerun/cancellation
- `P1`: recovery, settings, agent identity, tabs, session lifecycle, search/git/terminal, side paths
