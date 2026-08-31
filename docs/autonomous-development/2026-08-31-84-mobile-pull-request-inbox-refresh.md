# Synchronize the GitHub inbox on Mobile refresh

- **Date:** 2026-08-31
- **Problem:** Pulling to refresh the Mobile pull request inbox only reran reads against Cradle's cached feeds, so newly assigned reviews or updated authored pull requests could remain invisible.
- **Motivation:** The native refresh gesture should provide a trustworthy boundary between cached data and the latest external inbox.
- **Product behavior:** Pull-to-refresh now synchronizes the signed-in user's authored and review-request feeds from GitHub before repopulating the list. If synchronization fails, the current inbox stays visible and Mobile explains that the latest GitHub state could not be loaded.
- **Implementation summary:** Reused the login already owned by the list query to call the pull-request feed refresh endpoint, then refetched the canonical viewer/authored/reviewing query with error propagation. Existing native list refresh UI continues to own progress presentation.
- **Files / systems affected:** Mobile pull request inbox query orchestration.
- **Validation performed:** Targeted Mobile ESLint, Mobile TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** Manual refresh now waits for GitHub synchronization before refetching the inbox, trading a slightly longer spinner for reliable freshness.
- **Follow-up ideas:** Surface the last successful GitHub synchronization time if users need more explicit cache visibility.
- **Out of scope:** Background feed scheduling, pull request detail refresh, pagination, and server cache policy changes.
