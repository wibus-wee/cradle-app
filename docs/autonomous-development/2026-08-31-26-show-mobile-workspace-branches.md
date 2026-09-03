# Show workspace branch context on Mobile

- **Date:** 2026-08-31
- **Problem:** Mobile workspace rows showed only a name, even though branch names were searchable and often distinguish otherwise similar checkouts.
- **Motivation:** Branch context helps users choose the right project before opening a conversation or starting Work.
- **Product behavior:** Available workspaces now show their current Git branch beneath the name, with a neutral fallback when no branch exists. Missing workspaces explicitly say they are unavailable on the server.
- **Implementation:** The fixture-renderable Projects view presents existing typed workspace identity and availability fields; query and sorting behavior are unchanged.
- **Systems affected:** Mobile Projects view.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** The compact row shows branch rather than the longer filesystem path.
- **Follow-up ideas:** Expose the full path on the workspace detail screen when remote locator semantics are useful.
- **Out of scope:** Workspace mutation, branch switching, and server changes.
