# Search workspace files on mobile

- **Date:** 2026-08-31
- **Problem:** Mobile users could browse from the workspace root, but finding a known file still required walking the directory tree.
- **Motivation:** File search turns the existing preview and directory browser into a practical way to inspect larger repositories away from the desktop.
- **Product behavior:** A search action on workspace detail opens a focused search screen. Results distinguish files from directories and open the existing preview or directory browser. Empty, loading, no-result, and retryable error states are explicit.
- **Implementation:** The container debounces input for 250 ms and uses the server-owned workspace file search endpoint with a 50-result limit. The fixture-driven view owns only presentation and navigation callbacks.
- **Systems affected:** Mobile workspace detail, project routes, project fixtures, and mobile product documentation.
- **Validation:** `pnpm --filter @cradle/mobile typecheck`; scoped ESLint for the changed mobile files.
- **Tradeoffs:** Search is name-based and limited to 50 server-ranked results. Content search and saved queries are intentionally out of scope.
- **Follow-up ideas:** Add recent searches if repeated mobile repository inspection shows a clear need.
