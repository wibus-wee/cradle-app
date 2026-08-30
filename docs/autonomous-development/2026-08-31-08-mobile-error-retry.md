# Retry mobile load failures in place

- **Date:** 2026-08-31
- **Problem:** An initial mobile query failure rendered a description but no recovery action, forcing users to navigate away or restart after a transient server or network interruption.
- **Motivation:** Mobile connections are intermittent by nature; the primary Projects, Work, Usage, pull request, and conversation workflows should recover without losing navigation context.
- **Product behavior:** Recoverable load-error states now show a secondary Retry button. The button displays a spinner and disables itself while the owning query refetches. Semantic terminal states such as a missing conversation remain actionless.
- **Implementation summary:** Extended the props-only common error state with optional retry callback/loading props, then connected query-owning containers to their existing TanStack Query refetch functions. Conversation recovery refetches both metadata and history because either may own the visible failure.
- **Files / systems affected:** Mobile common state UI and Projects, workspace detail, Work list/detail, Usage, pull request list/detail, and chat containers.
- **Validation performed:** Mobile TypeScript checking and ESLint across all changed source files.
- **Tradeoffs:** Retry repeats the same request and preserves the existing automatic query retry policy. It does not add offline caching or change server error classification.
- **Follow-up ideas:** Add a connection-status banner when the app can reliably distinguish device offline state from a reachable server returning an application error.
