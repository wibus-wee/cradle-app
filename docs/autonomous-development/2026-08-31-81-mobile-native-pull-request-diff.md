# Review pull request patches in a native iOS sheet

- **Date:** 2026-08-31
- **Problem:** The pull request detail response already included file patches, but Mobile discarded them and sent every changed-file tap to GitHub.
- **Motivation:** Reviewers need a fast way to understand a small change without losing their place in Cradle or waiting for a browser page to load.
- **Product behavior:** Tapping a changed file with an available patch now opens a native iOS sheet. The sheet shows filename, status, additions, deletions, selectable monospaced diff lines, and two-axis scrolling for long code. Standard unified-diff additions, deletions, hunk headers, and metadata receive distinct system colors. A Safari action remains available. Files without an inline patch continue to open on GitHub directly.
- **Implementation summary:** Added a fixture-driven SwiftUI diff sheet that reads the existing pull request file contract. The detail View owns only selected-file presentation state and delegates external navigation through its existing callback; no new endpoint or frontend data projection was introduced.
- **Files / systems affected:** Mobile native pull request detail and changed-file review UI.
- **Validation performed:** Targeted Mobile ESLint, Mobile TypeScript typecheck, iOS production bundle export, and diff whitespace validation.
- **Tradeoffs:** The sheet displays the patch supplied by GitHub through the existing API, which can be absent or truncated for binary or very large changes. The explicit Safari action is the complete-file fallback.
- **Follow-up ideas:** Add inline review comments if the server later owns line-level review mutations and stable diff positions.
- **Out of scope:** Fetching full blobs, syntax highlighting, side-by-side layout, line comments, and non-iOS behavior.
