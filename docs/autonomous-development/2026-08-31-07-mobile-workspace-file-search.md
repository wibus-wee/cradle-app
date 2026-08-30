# Search workspace files on Mobile

- **Date:** 2026-08-31
- **Problem:** The Mobile file browser required users to know and traverse the exact directory containing a file.
- **Motivation:** Searching by a remembered filename is usually the fastest way to inspect code from a phone.
- **Product behavior:** The file browser now searches the whole workspace, shows full result paths, opens matching files, and enters matching directories. Closing a file returns to the preserved results.
- **Implementation:** `WorkspaceFilesContainer` owns cancellable server searches capped at 100 results, while `WorkspaceFilesView` renders a controlled search field and fixture-driven result states.
- **Systems affected:** Mobile workspace file browser and its fixture.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Requests start for each non-empty query rather than adding a timing heuristic; React Query cancels superseded requests through the existing abort signal.
- **Follow-up ideas:** Add content search only if filename search proves insufficient during dogfooding.
- **Out of scope:** Fuzzy ranking, content search, saved queries, and server contract changes.
