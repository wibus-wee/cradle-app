# Retry failed Mobile routes in place

- **Date:** 2026-08-31
- **Problem:** A temporary connection, server, or GitHub failure left Mobile route error states at a dead end. Users had to navigate away and reopen the feature even when the underlying service had already recovered.
- **Motivation:** Recovery should be explicit and local to the failed task. A visible retry action is easier to understand than hidden polling and avoids discarding navigation or composer context.
- **Product behavior:** Failed project, workspace, Work, Usage, pull request, conversation, and file requests now offer Try Again in place. iOS uses a prominent native SwiftUI button; Android and Web use the existing shared button. While refetching, the action shows progress and is disabled to prevent duplicate requests. Each route keeps its original error title and diagnostic detail.
- **Implementation:** The shared state contract gained optional action, label, and pending props. Containers pass their existing React Query `refetch` functions and real `isFetching` state. Conversation retry refreshes both metadata and transcript history; file retry refreshes both file information and preview content when applicable. No retry state is duplicated inside the presentation components.
- **Systems affected:** Mobile shared route-state primitives and Mobile Containers for Projects, Workspace, Workspace Files, Work, Chat, Usage, and Pull Requests.
- **Validation:** Mobile ESLint and TypeScript passed, and Expo production exports completed for iOS, Android, and Web.
- **Tradeoffs:** Retry remains user-initiated after React Query's existing request behavior. A route with several parallel requests retries the failed workflow together because partial success is not independently actionable on these screens.
- **Follow-up ideas:** Add specialized recovery actions where an error has a known remedy, such as opening Connection settings for authentication failures.
- **Out of scope:** Infinite retry loops, connection-policy changes, server error taxonomy, offline request queues, and changing route-specific error wording.
