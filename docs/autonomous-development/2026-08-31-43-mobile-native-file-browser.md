# Browse workspace files in a native iOS list

- **Date:** 2026-08-31
- **Problem:** After file search moved into the native header, the iOS directory rows, hierarchy controls, refresh behavior, empty states, and text preview still used a custom React Native surface.
- **Motivation:** File browsing maps directly to iOS list navigation. Native rows improve touch feedback, Dynamic Type, icon consistency, disclosure affordance, pull-to-refresh, and accessibility while making directory and search context easier to scan.
- **Product behavior:** iOS now renders workspace directories and files in an inset-grouped SwiftUI List with SF Symbols, 44-point navigation rows, explicit context-aware Back/Clear Search/Parent actions, native pull-to-refresh, full paths for search results, and system empty states. Text previews use selectable Dynamic Type-aware monospaced text and show native unavailable states with the existing 128 KB limit. Android and Web retain the existing React Native file browser.
- **Implementation:** `WorkspaceFilesView.ios.tsx` is a platform-specific fixture-driven View with no query or route dependencies. A shared props contract and formatting/preview model keep path names, file sizes, and unavailable explanations consistent between iOS and the base View. Refresh callbacks can now return a promise so the native refresh indicator tracks the actual refetch.
- **Systems affected:** Mobile Workspace Files platform Views, View contract, shared display model, Container refresh callback, and fixture imports.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web.
- **Tradeoffs:** Large text previews remain one selectable native text region and intentionally do not add syntax highlighting. Directory navigation stays within the existing route state, so the View keeps an explicit parent row rather than changing the navigation stack model.
- **Follow-up ideas:** Dogfood long file names and deeply nested paths, then consider native context menus for copy/share only if those actions are frequently needed.
- **Out of scope:** File editing, download, sharing, syntax highlighting, content search, server API changes, and Android list migration.
