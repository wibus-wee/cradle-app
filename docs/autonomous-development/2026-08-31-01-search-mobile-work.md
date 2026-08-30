# Search active Work on Mobile

- **Date:** 2026-08-31
- **Problem:** Mobile users had to scan the complete active Work list to find a specific task.
- **Motivation:** Work is the primary remote-control queue, so finding an item should remain quick as the queue grows.
- **Product behavior:** The Mobile Work screen now filters immediately by title, objective, or workspace name and explains how to recover when no item matches.
- **Implementation:** The fixture-renderable `WorkListView` owns transient search state and filters the already-bounded Work response before date grouping.
- **Systems affected:** Mobile Work list UI only.
- **Validation:** Mobile TypeScript and ESLint checks.
- **Tradeoffs:** Search covers the 200 active Work items already loaded by the screen rather than querying the server.
- **Follow-up ideas:** Persist the last query only if dogfooding shows repeated navigation is erasing useful context.
- **Out of scope:** Server-side search, archived Work, and cross-screen global search.
