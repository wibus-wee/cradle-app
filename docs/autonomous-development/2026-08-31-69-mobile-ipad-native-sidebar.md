# Adapt Mobile navigation to an iPad sidebar

- **Date:** 2026-08-31
- **Problem:** Cradle always presented its four primary destinations as a bottom tab bar, even when an iPad had enough width for native sidebar navigation.
- **Motivation:** Wide-screen Mobile use benefits from persistent, readable navigation without inventing a Cradle-specific iPad shell.
- **Product behavior:** On iPadOS 26, the system can now adapt Cradle's native tabs between a tab bar and sidebar based on the current context. iPhone continues to use its regular native tab bar and scroll minimization behavior.
- **Implementation summary:** Enabled Expo Router's native `sidebarAdaptable` tab mode for iOS, which maps to UIKit's tab/sidebar presentation and keeps platform ownership of size-class adaptation.
- **Files / systems affected:** Mobile native tab navigation on iOS and iPadOS.
- **Validation performed:** Targeted Mobile ESLint, TypeScript typecheck, Expo public config generation, and diff whitespace validation.
- **Tradeoffs:** The sidebar structure mirrors the existing four top-level tabs; custom grouping, reordering, and sidebar-only commands are deferred until dogfooding shows a concrete need.
- **Follow-up ideas:** Evaluate a two-column workspace experience once the adaptive top-level navigation has been used on iPad.
- **Out of scope:** Custom split-view architecture, iPhone navigation changes, Android navigation, and desktop/web UI.
