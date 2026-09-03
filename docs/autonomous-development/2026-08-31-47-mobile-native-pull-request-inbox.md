# Triage pull requests in a native iOS inbox

- **Date:** 2026-08-31
- **Problem:** The Pull Request inbox combined a native search header with custom segmented control layout, grouped headings, rows, check indicators, status pills, empty states, and refresh behavior on iOS.
- **Motivation:** Pull request triage is a daily navigation workflow that maps directly to iOS lists. Native grouping, selection, row feedback, status symbols, Dynamic Type, disclosure indicators, and pull-to-refresh make authored and review-request queues faster to scan.
- **Product behavior:** iOS now switches Authored and Review Requests with a native segmented Picker, groups results into Today, This Week, and Older sections, and renders each pull request as a 44-point native row with check status SF Symbol, title, monospaced repository/number, draft or state, relative update time, and disclosure indicator. Native header search still filters title, owner, repository, and number; empty searches and empty inboxes use system ContentUnavailableView. Pull-to-refresh waits for the actual refetch. Android and Web retain the existing inbox UI.
- **Implementation:** `PullRequestListView.ios.tsx` is a platform-specific fixture-driven View. A shared props contract owns the row type and refresh callback, while shared search and age-group helpers keep both platform Views behaviorally aligned. The Container remains responsible for viewer/authored/reviewing queries and route navigation.
- **Systems affected:** Mobile pull request list platform Views, shared list contract/model, list Container refresh callback, and pull request fixtures.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web.
- **Tradeoffs:** The native row uses compact textual status labels beside symbols so it remains readable without introducing a custom badge system. Age groups remain relative to the device clock, matching the prior behavior.
- **Follow-up ideas:** Dogfood long titles and repository names at accessibility sizes; consider optional sorting only if the current updated-time ordering becomes insufficient.
- **Out of scope:** PR detail redesign, merge actions, notifications, custom sorting, server query changes, and Android list migration.
