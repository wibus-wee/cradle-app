# Browse workspace directories on mobile

- **Date:** 2026-08-31
- **Problem:** Mobile workspace detail showed top-level directories but left them inert, so file preview only worked for files stored at the workspace root.
- **Motivation:** Most source and documentation files live below the root. Directory navigation makes the existing mobile preview useful for real repositories.
- **Product behavior:** Tapping a directory opens its immediate children in a native stack screen. Users can descend through further directories, open files in the existing preview, pull to refresh, navigate back with native gestures, and see explicit loading, error, and empty states.
- **Implementation summary:** Added a Projects-domain directory Container/View, a query-parameter route, and fixture data. Each screen reads the existing path-scoped workspace children API rather than materializing a full client-side tree.
- **Files / systems affected:** Mobile workspace overview, directory route/View/container/fixtures, root navigation, mobile documentation, and autonomous journal.
- **Validation performed:** Mobile TypeScript checking, ESLint on changed source files, and diff validation.
- **Tradeoffs:** Navigation is intentionally one directory per request and does not add search, breadcrumbs, editing, or file operations. The native stack title shows only the current directory name while back navigation preserves ancestry.
- **Follow-up ideas:** Add workspace file search as a separate mobile workflow if deep traversal proves slow for large repositories.
