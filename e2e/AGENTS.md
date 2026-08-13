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
```

`CRADLE_E2E_NODE` may point the managed server at a repository-compatible Node
binary. `CRADLE_E2E_BROWSER_PATH` may point local runs at an existing Chromium
executable; CI installs the Playwright-pinned browser instead.

## CI gate

- PR smoke (`e2e-smoke.yml`) runs `@P0` when **critical paths** change
  (`e2e/**`, `packages/model-api-simulator/**`, `apps/web/**`, `apps/server/**`, …)
  **or** when the `e2e` label is present (force / keep running).
- Always checks out the **PR head**, provisions Codex via `sync:codex-runtime`.
- Both workflows run `pnpm e2e:check` before expensive builds and browser setup.
- Full E2E tag runs: push `e2e/full/<name>` at an open PR head. The workflow
  checks out the exact tagged commit, runs the same `@P0 or @P1` full active
  priority suite, and updates a failure comment on every associated open PR.
  If the commit is not associated with an open PR, the run still executes but
  only reports through Actions.
- Daily (`e2e-daily.yml`) defaults to **`@P0 or @P1`** (full active priority suite).
  Scheduled/manual failures open a GitHub Issue labeled `daily-e2e-failure`
  assigned to `wibus-wee`.
- Tag model:
  - `@P0` — smoke / must-never-break core path
  - `@P1` — important journeys (daily with P0)
  - `@essence` — quality marker on every live scenario (not a CI selector)
- **No `@wip`.** Unfinished scenarios do not land on the branch. Fix them or do not commit them.

## Quality bar（精）

Every scenario must be a real multi-link user journey. Prefer depth over count.
Shallow “page is visible” checks belong in unit/component tests, not here.

If the simulator cannot express a needed wire behaviour, **extend the simulator** —
do not invent a parallel mock LLM.

## Authoring Rules

- Write `.feature` files in Chinese.
- Tags: `@cradle`, `@P0`/`@P1`, `@essence`, plus stable IDs like `@CRADLE-CHAT-001`.
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

## Simulator usage

- `configureClaudeAgentChat` — Anthropic Messages + real Claude Agent
- `configureCodexChat` — OpenAI Responses + real Codex app-server
- `configureStandardChat` — OpenAI Responses + standard runtime (legacy / Agents path)
- Scenario builders live in `e2e/src/support/scenarios/`
- Just-in-time enqueue for multi-turn Claude so intermediate SDK calls cannot steal FIFO
- Page objects live in `e2e/src/support/pages/` — keep step defs thin
- Cradle wire fixtures / conformance: `packages/model-api-simulator/fixtures/cradle/`

## Scenario Scope

- `P0`: smoke — onboarding, core chat/queue recovery, Claude approval, Codex rollback,
  Work isolation, and Issue delegation/rerun/cancellation
- `P1`: recovery, settings, agent identity, tabs, session lifecycle, search/git/terminal, side paths
