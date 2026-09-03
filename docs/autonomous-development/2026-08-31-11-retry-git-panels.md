# Retry Git panel load failures

- **Date:** 2026-08-31
- **Problem:** A failed repository discovery or commit graph request left the Git History and Changes panels in a terminal error state, even though Git queries intentionally disable automatic retries.
- **Motivation:** Transient filesystem, process, and workspace readiness failures should not force developers to switch workspaces or reload the application.
- **Product behavior:** Repository and graph error states now include a localized Retry action. The action disables itself and shows a spinning refresh icon while the replacement request is active.
- **Implementation summary:** Extended the fixture-driven Git panel Views with retry callbacks and pending state, while their containers retain ownership of TanStack Query refetching. Added focused coverage for the Changes repository recovery path.
- **Files / systems affected:** Web Git History and Changes Views, containers, stories, locales, tests, and feature documentation.
- **Validation performed:** Focused Changes panel test, web TypeScript checking, ESLint on changed source files, and locale JSON parsing.
- **Tradeoffs:** Retry remains user-initiated because automatic retries would repeat persistent repository and permission failures without adding useful feedback.
- **Follow-up ideas:** Surface structured server error details when the Git API exposes stable, user-safe failure categories.
