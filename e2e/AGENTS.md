# E2E Testing Guide

This file applies to everything under `e2e/`.

## Stack

- Use `@cucumber/cucumber` for feature files and step definitions.
- Use `@playwright/test` (`_electron`) for Electron app launching, window control, and assertions.
- Use `tsx` to run ESM TypeScript entrypoints.
- Keep the E2E config in `e2e/cucumber.mjs` and `e2e/tsconfig.json`.

## Commands

- Build the app first — E2E tests launch the compiled `out/main/index.js`:
  - `pnpm build`
- Run all feature files:
  - `npx cucumber-js --config e2e/cucumber.mjs`
- Run a specific tag:
  - `npx cucumber-js --config e2e/cucumber.mjs --tags "@smoke"`
- Clean up leftover test data:
  - `npx tsx e2e/scripts/cleanup.ts`

## Recommended Workflow

1. Analyze current coverage.
   - List existing feature files under `e2e/src/features/`.
   - Inspect the real UI and state flow in `src/renderer/src/`, `src/main/`, and `src/preload/` before adding tests.
2. Choose one user journey to extend.
   - Prefer exactly one new journey per change unless the work is tightly coupled.
   - Follow the priority order `P0 -> P1 -> P2`.
   - Choose core product behavior first, not cosmetic routes.
3. Design the scenario in Gherkin.
   - Write or extend one `.feature` file under `e2e/src/features/`.
   - Keep scenarios in Chinese and use stable tags like `@cradle @P1 @CRADLE-XYZ-001`.
   - Prefer one scenario per user outcome.
4. Implement step definitions and support code.
   - Add or extend step files under `e2e/src/steps/`.
   - Reuse `CradleWorld`, selectors, and hooks before inventing new helpers.
   - Access `this.app` (ElectronApplication) and `this.page` (Page) in steps.
   - Use `this.mainProcess(...)` for main-process assertions (e.g. checking IPC results).
   - If the test needs new app anchors, add minimal `data-testid` support in app code.
5. Keep test data and cleanup correct.
   - The app's `userData` is redirected to `cradle-e2e` (a throw-away directory) via `--user-data-dir` so tests never touch real data.
   - If cleanup scope changes, update `e2e/scripts/cleanup.ts` in the same change.
6. Validate in the right order.
   - Run `pnpm build` first.
   - Run targeted tags next, for example `npx cucumber-js --config e2e/cucumber.mjs --tags "@P0"`.
   - Run the full suite before finishing if shared hooks, selectors, cleanup, or support code changed.
7. Fix failures by tightening determinism.
   - Prefer better selectors and explicit visible-state assertions over long waits.
   - If a failure reveals a real product bug, fix the product bug and keep the test.
   - If a scenario is inherently unstable, do not silently weaken it; document the issue.

## Authoring Rules

- Write `.feature` files in Chinese.
- Keep scenario tags explicit and stable: `@cradle`, `@P0`, `@P1`, `@P2`, plus scenario IDs like `@CRADLE-CRUD-001`.
- Put reusable Electron setup and environment setup in `e2e/src/support/`, not in step files.
- Keep step definitions thin: orchestrate UI actions and assertions, do not duplicate app business logic.
- Add `console.log` step traces for debugging.
- Prefer `data-testid` selectors first, then role/label selectors, and use visible text only when the UI text is intentionally stable.
- When selectors are flaky, add the smallest possible `data-testid` to production UI instead of using brittle CSS traversal.
- Do not share mutable state between scenarios (each `Before` spawns a new Electron instance).

## Writing Feature Files

- Place feature files under `e2e/src/features/`.
- Prefer one file per functional area, for example:
  - `workspace.feature`
  - `session.feature`
- Prefer one scenario per user outcome.
  Do not combine multiple unrelated outcomes into one scenario.
- Use product language in steps, not implementation language.
  Keep DOM details in step definitions.
- Reuse existing step sentences when the behavior is the same.
  Do not create near-duplicates.

## Test Data and Isolation

- Each scenario launches a fresh Electron instance with an isolated `cradle-e2e` userData directory.
- Do not share mutable state between scenarios.
- Use `e2e/scripts/cleanup.ts` to delete the `cradle-e2e` userData directory between runs if needed.
- If you add new persistent state that E2E tests produce, update `e2e/scripts/cleanup.ts`.

## Scenario Scope

- `P0`: app launch, window creation, basic navigation.
- `P1`: workspace CRUD, session management, IPC round-trips.
- `P2`: richer editor or relationship flows if they become core journeys.
- Do not expand scope casually; add the next user journey only after the existing suite stays green.

## Stability Rules

- Favor deterministic assertions on visible user outcomes.
- Do not assert internal query cache state or request counts unless a test explicitly targets that contract.
- Use unique content per run with a `runId` if applicable.
- If a failure is caused by environment issues, fail fast in hooks instead of timing out inside steps.

## Files to Update Together

- New scenarios usually require coordinated updates to:
  - `e2e/src/features/*.feature`
  - `e2e/src/steps/*.steps.ts`
- If a new selector is added, update the app component and the corresponding step definitions.
- If cleanup scope changes, update `e2e/scripts/cleanup.ts`.
