# Copy full commit SHAs from Git history

- **Date:** 2026-08-31
- **Problem:** Git history displayed abbreviated SHAs in rows and the full value inside a delayed tooltip, but using a revision elsewhere required precise text selection.
- **Motivation:** Developers frequently move exact revisions into terminals, issues, review comments, and agent prompts while inspecting history.
- **Product behavior:** Every commit row now includes a compact copy icon with a localized accessible label. Activating it copies the full SHA and shows success or failure feedback.
- **Implementation summary:** Added a copy callback to the fixture-driven commit and repository Views, while the Git repository container owns clipboard access and toast reporting.
- **Files / systems affected:** Web Git history Views/container, Git fixtures, locale resources, and feature documentation.
- **Validation performed:** Focused commit-row interaction test, web TypeScript checking, ESLint on changed source files, and locale JSON parsing.
- **Tradeoffs:** The icon is always visible so the action remains discoverable on touch devices; it uses a small fixed footprint to preserve the dense history layout.
- **Follow-up ideas:** Add provider-specific commit links only after repository remotes have a canonical, privacy-safe URL projection.
