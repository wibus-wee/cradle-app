# Use native iOS loading and error states

- **Date:** 2026-08-31
- **Problem:** Mobile's iOS feature pages increasingly used native SwiftUI surfaces, but their route-level loading and error transitions still rendered a custom React Native spinner or Lucide state. The visual language changed precisely when users were waiting or troubleshooting.
- **Motivation:** Loading and failure states appear throughout the product and shape perceived reliability. A shared native primitive makes every migrated route feel coherent while preserving each feature's existing copy and data ownership.
- **Product behavior:** On iOS, route loading now uses a centered SwiftUI progress indicator and dynamic system label. Errors and generic empty states use SF Symbols, semantic colors, centered dynamic type, readable line length, and descriptions supplied by their owning feature. Android and Web keep their established presentation.
- **Implementation:** Platform resolution selects a new `states.ios.tsx` implementation for all existing imports. A small shared contract keeps the public props consistent with the React Native implementation. The native state is composed from iOS 16-compatible SwiftUI primitives rather than `ContentUnavailableView`, because Cradle's deployment target remains iOS 16.4 and that system view requires iOS 17.
- **Systems affected:** Mobile universal state primitives and every iOS Container that already uses LoadingState or ErrorState.
- **Validation:** Mobile ESLint and TypeScript passed, and Expo production exports completed for iOS, Android, and Web.
- **Tradeoffs:** The iOS empty-state primitive intentionally uses one system tray symbol instead of translating arbitrary Lucide icons. Current iOS business Views already own their richer empty-state symbols; this fallback primarily serves route states.
- **Follow-up ideas:** Add retry callbacks to the shared error contract when enough routes can provide a meaningful retry action, and adopt native skeletons only where measured load times justify them.
- **Out of scope:** Changing feature-specific error copy, adding automatic retries, Android/Web redesign, skeleton frameworks, and raising the iOS deployment target.
