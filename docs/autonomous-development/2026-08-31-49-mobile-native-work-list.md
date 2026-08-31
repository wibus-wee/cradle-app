# Operate Work from a native iOS list

- **Date:** 2026-08-31
- **Problem:** The Work tab used custom React Native segmented controls, rows, status dots, refresh, and empty states on iOS even though it is the primary place users monitor and resume agent activity.
- **Motivation:** A native list makes the most frequently scanned operational surface easier to read with Dynamic Type, familiar grouped sections, system selection feedback, semantic SF Symbols, and predictable touch targets.
- **Product behavior:** iOS now presents Active and Archived Work in an inset-grouped SwiftUI `List`. Native segmented pickers retain the lifecycle and All/Running/Attention filters, rows remain grouped by recency, and activity is expressed with a labeled semantic symbol rather than color alone. Each row has separate 44-point targets for opening its primary session and its Work details. Search still covers title, objective, and workspace; pull-to-refresh waits for the server refetch; and filtered empty states explain what will appear. The existing Work Composer remains available for active Work and collapses before navigation or filter changes. Android and Web retain the existing surface.
- **Implementation:** `WorkListView.ios.tsx` owns only local presentation filters and composes the existing feature-owned Work Composer. A shared View contract and model now own search matching, recency grouping, and cross-platform activity tone semantics so the native and React Native Views cannot drift on product rules.
- **Systems affected:** Mobile Work list platform Views, shared Work list contract/model, Work query refresh callback, and fixture imports.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web.
- **Tradeoffs:** The row keeps an explicit info button instead of relying on swipe actions or context menus because opening the session and inspecting Work metadata are both established primary actions. The composer remains React Native at a deliberate feature seam.
- **Follow-up ideas:** Dogfood dense lists with long objectives and workspace names; consider a separately scoped native Work Composer after measuring creation friction.
- **Out of scope:** Work creation redesign, archive mutations, sorting changes, API changes, workspace selection changes, and Android list migration.
