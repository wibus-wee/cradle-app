# Recover from empty plugin filters

- **Date:** 2026-08-29
- **Problem:** Installed Plugins could explain an empty search/filter result but offered no direct way back to the full list.
- **Motivation:** Combining a text query with On/Off filters is useful, and recovery should not require undoing each input separately.
- **Product behavior:** Active search text has an inline clear action; the no-results card can clear both the query and activation filter in one click.
- **Implementation:** The existing local filter state is reset in place, with a reusable optional reset action on the tab's Empty State.
- **Systems affected:** Installed Plugins and settings translations.
- **Validation:** Web typecheck, targeted ESLint, locale JSON parsing, and pre-commit validation.
- **Tradeoffs:** Reset returns to All rather than preserving the activation filter, matching the empty-state promise to show every installed plugin.
- **Follow-up ideas:** Add per-filter counts if plugin inventories commonly become large.
- **Out of scope:** Persisted plugin filters and marketplace filtering.
