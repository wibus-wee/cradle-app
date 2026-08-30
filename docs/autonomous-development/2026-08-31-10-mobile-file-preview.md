# Preview workspace files on mobile

- **Date:** 2026-08-31
- **Problem:** Mobile workspace detail displayed file rows, but they were decorative and could not be inspected.
- **Motivation:** Read-only access to project context is useful when reviewing Work or following a conversation away from the desktop.
- **Product behavior:** Tapping a top-level file opens a refreshable preview. Text files render as selectable monospaced source and Markdown files render as formatted content. Unsupported binary formats show an explicit limitation instead of attempting unsafe text decoding.
- **Implementation summary:** Added a typed file-preview route, Container, fixture-driven View, and fixtures. The Container fetches server-owned preview metadata first and requests content only for text/Markdown kinds; the workspace View delegates file navigation through a callback.
- **Files / systems affected:** Mobile routing, workspace detail, project feature Views/container/fixtures, and mobile documentation.
- **Validation performed:** Mobile TypeScript checking and ESLint across changed source files.
- **Tradeoffs:** This first slice is read-only and limited to top-level files surfaced by workspace detail. Directory traversal, editing, syntax highlighting, and binary media previews remain outside the feature.
- **Follow-up ideas:** Add directory navigation and reuse the server's raw/PDF rendition routes for image and document previews.
