# Preserve notes typed during autosave

- **Date:** 2026-08-29
- **Problem:** If a user kept typing while an earlier note save was in flight, the response-driven server refresh could replace the newer draft with the older saved text.
- **Motivation:** Autosave must never make recent user input disappear, even when requests and typing overlap.
- **Product behavior:** Newer local edits survive stale save responses. Clean drafts still accept server updates, and switching sessions always loads the selected session's notes.
- **Implementation:** The environment panel tracks its previous server snapshot and applies a small pure reconciliation rule before updating the controlled draft.
- **Systems affected:** Session note state, environment hydration, Environment page object, and unit/E2E coverage.
- **Validation:** Three reconciliation tests, web typecheck, targeted ESLint, and `CRADLE-ENV-001`, which delays a real save while the user continues typing and then verifies the newest draft after reload. Local browser execution requires the Playwright Chromium matching the upgraded dependency.
- **Tradeoffs:** A dirty local draft takes precedence over same-session remote updates; there is no field-level merge.
- **Follow-up ideas:** Add conflict messaging if notes become editable from multiple clients concurrently.
- **Out of scope:** Collaborative editing and note version history.
