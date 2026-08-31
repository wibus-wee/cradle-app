# Discover the Mobile file browser

- **Date:** 2026-08-31
- **Problem:** Workspace summaries showed only 12 root entries and offered no explicit path into the full Mobile file browser.
- **Motivation:** A capability is not useful when users must infer that tapping an arbitrary file is the way to discover it.
- **Product behavior:** Every workspace with files now shows a dedicated “Browse all files” row before its compact root summary.
- **Implementation:** `WorkspaceView` adds a semantic browser row and callback; `WorkspaceContainer` translates it into the existing browser route.
- **Systems affected:** Mobile workspace detail, container, and fixture contracts.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** The workspace summary remains capped at 12 entries to keep Work and conversations prominent.
- **Follow-up ideas:** Measure whether users prefer files above conversations before changing section order.
- **Out of scope:** Removing the summary cap, changing file APIs, and redesigning workspace navigation.
