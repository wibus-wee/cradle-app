# E2E Testing Guide

This file applies to everything under `e2e/`.

## Stack

- Use `@cucumber/cucumber` for feature files and step definitions.
- Use `@playwright/test` (Chromium) for the **web** E2E path: managed `apps/server` + `apps/web`.
- Use `@cradle/model-api-simulator` as the deterministic LLM wire substitute (OpenAI Responses + Anthropic Messages).
- Do **not** set `CRADLE_MOCK_LLM_URL` in E2E — that swaps in a fake Claude Agent runtime. Essence tests must use the real Claude Agent Provider.
- Keep the E2E config in `e2e/cucumber.mjs` and `e2e/tsconfig.json`.

## Commands

- Run essence / P0 scenarios (server+web auto-start via BeforeAll):
  - `npx cucumber-js --config e2e/cucumber.mjs --tags "@P0"`
- Run full essence suite:
  - `npx cucumber-js --config e2e/cucumber.mjs --tags "@essence"`
- Clean up leftover test data:
  - `npx tsx e2e/scripts/cleanup.ts`

## Quality bar（精）

Every scenario must be a real multi-link user journey. Prefer depth over count.
Shallow “page is visible” checks belong in unit/component tests, not here.

Archive retired features under `e2e/_archive/` (outside cucumber `paths`).

## Authoring Rules

- Write `.feature` files in Chinese.
- Tags: `@cradle`, `@essence`, `@P0`/`@P1`, plus stable IDs like `@CRADLE-CHAT-001`.
- Put reusable setup in `e2e/src/support/` (simulator, providers, scenarios, pages).
- Keep step definitions thin; use page objects under `e2e/src/support/pages/`.
- Prefer `data-testid` selectors first.
- Each scenario launches a fresh browser context; server state is reset via `/test/reset`.

## Simulator usage

- `CradleWorld.configureStandardChat(...)` enqueues OpenAI Responses exchanges and upserts an openai-compatible profile.
- `CradleWorld.configureClaudeAgentChat(...)` enqueues Anthropic Messages exchanges, disables title generation via a dead sink profile, and uses the real Claude Agent runtime.
- Use scenario builders in `e2e/src/support/scenarios/` — do not hand-roll invalid SSE.
- `autoRespond` absorbs probe traffic; conversation turns stay FIFO-matched.

## Scenario Scope

- `P0`: smoke — core chat, Claude approval, workspace/kanban entry.
- `P1`: deeper recovery, reasoning, session lifecycle, important side paths.
- Do not expand with watery scenarios; each new journey must clear the quality bar.
