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
# Optional: provision native Codex app-server for Codex essence scenarios
pnpm --filter @cradle/desktop sync:codex-runtime
pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@P0"
pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@essence"
pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "not @wip"
```

## CI gate

- PR smoke (`e2e-smoke.yml`) runs `@P0` when **critical paths** change
  (`e2e/**`, `packages/model-api-simulator/**`, `apps/web/**`, `apps/server/**`, …)
  **or** when the `e2e` label is present (force / keep running).
- Always checks out the **PR head**, provisions Codex via `sync:codex-runtime`.
- Daily defaults to `@essence`.

## Quality bar（精）

Every scenario must be a real multi-link user journey. Prefer depth over count.
Shallow “page is visible” checks belong in unit/component tests, not here.

If the simulator cannot express a needed wire behaviour, **extend the simulator** —
do not invent a parallel mock LLM.

Archive retired features under `e2e/_archive/` (outside cucumber `paths`).

## Authoring Rules

- Write `.feature` files in Chinese.
- Tags: `@cradle`, `@essence`, `@P0`/`@P1`, plus stable IDs like `@CRADLE-CHAT-001`.
- Put reusable setup in `e2e/src/support/` (simulator, providers, scenarios, pages).
- Keep step definitions thin; use page objects under `e2e/src/support/pages/`.
- Prefer `data-testid` selectors first.
- After LLM turns settle, prefer `Simulator 脚本化交换应全部耗尽` (`assertExhausted`).

## Simulator usage

- `configureClaudeAgentChat` — Anthropic Messages + real Claude Agent
- `configureCodexChat` — OpenAI Responses + real Codex app-server
- `configureStandardChat` — OpenAI Responses + standard runtime (legacy / Agents path)
- Scenario builders live in `e2e/src/support/scenarios/`
- Just-in-time enqueue for multi-turn Claude so intermediate SDK calls cannot steal FIFO
- Page objects live in `e2e/src/support/pages/` — keep step defs thin
- Cradle wire fixtures / conformance: `packages/model-api-simulator/fixtures/cradle/`

## Scenario Scope

- `P0`: smoke — core chat, Claude approval, Codex one-shot, workspace/kanban entry
- `P1`: recovery, reasoning, session lifecycle, search/git/terminal, important side paths
