# Force-refresh pull request details from iOS

- **Date:** 2026-08-31
- **Problem:** Pull request detail could display cached checks, conversation, and merge readiness with no user-controlled way to synchronize GitHub.
- **Motivation:** Review decisions depend on current external state. A familiar pull gesture should mean “fetch the latest GitHub state,” not merely reread Cradle's cache.
- **Product behavior:** Pulling down on the native iOS pull request detail list now shows the system refresh control, forces a synchronous GitHub refresh for that pull request, and reloads the complete detail. Existing content stays visible during the operation. A failed sync presents a focused error without discarding the current detail.
- **Implementation summary:** Added an optional refresh callback to the existing detail View contract, attached SwiftUI's `refreshable` modifier on iOS, and wired the Container to the owned pull-request detail refresh endpoint with `force: true` before refetching query state.
- **Files / systems affected:** Mobile pull request detail View contract, native iOS list, and Container query orchestration.
- **Validation performed:** Targeted Mobile ESLint, Mobile TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** A manual refresh performs two sequential server calls—one to synchronize GitHub and one to read the canonical detail—so it prioritizes correctness over minimum latency.
- **Follow-up ideas:** Give the pull request inbox refresh gesture the same explicit feed-synchronization semantics.
- **Out of scope:** Background refresh scheduling, optimistic check updates, Work readiness refresh, and non-iOS presentation.
