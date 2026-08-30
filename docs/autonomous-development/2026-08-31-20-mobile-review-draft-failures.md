# Preserve failed mobile review drafts

- **Date:** 2026-08-31
- **Problem:** Mobile pull-request comments were cleared before the server accepted them, and comment or review failures produced no visible feedback.
- **Motivation:** Losing a carefully written review note on an unreliable mobile connection is costly and makes retrying needlessly difficult.
- **Product behavior:** Comment and review text now clears only after a successful request. Failed requests show a specific native alert with the server error and keep the draft in the editor for correction or retry.
- **Implementation summary:** Made the fixture-driven View action contracts asynchronous and tied local draft clearing to promise resolution. The Container now uses `mutateAsync` and owns mutation-specific error alerts through TanStack Query.
- **Files / systems affected:** Mobile pull-request detail View/container/fixture, mobile documentation, and autonomous journal.
- **Validation performed:** Mobile TypeScript checking, ESLint on changed source files, and diff validation.
- **Tradeoffs:** Drafts survive request failures and refreshes within the mounted screen but are not persisted across navigation or process restarts. Successful reviews now clear an optional note consistently with comments.
- **Follow-up ideas:** Add persisted per-pull-request drafts only if navigation loss is a demonstrated mobile pain point.
