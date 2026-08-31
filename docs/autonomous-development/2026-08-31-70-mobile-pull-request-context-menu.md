# Act on pull requests from a native context menu

- **Date:** 2026-08-31
- **Problem:** The iOS pull request inbox required opening a detail screen before users could jump to GitHub or share a pull request.
- **Motivation:** These are frequent item-specific actions, especially on iPad with a trackpad, and should be available without cluttering every list row.
- **Product behavior:** Long-pressing or secondary-clicking a pull request now opens a native context menu with Open Pull Request, Open in GitHub, and Share Pull Request. Normal row selection still opens the detail screen, where the same secondary actions remain discoverable in the toolbar.
- **Implementation summary:** Wrapped native SwiftUI pull request rows in Expo UI ContextMenu and routed its callbacks through the fixture-driven View contract to the container-owned navigation, Linking, and system share APIs.
- **Files / systems affected:** Mobile pull request list View contract, iOS list rendering, container actions, and fixtures.
- **Validation performed:** Targeted Mobile ESLint, TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** The menu intentionally stays at three non-destructive actions; review and merge decisions remain in the detail screen where their context is visible.
- **Follow-up ideas:** Dogfood context-menu previews on iPhone and iPad before deciding whether a richer custom preview improves target confirmation.
- **Out of scope:** Pull request mutations, custom previews, Android context menus, and desktop/web UI.
