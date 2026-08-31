# Keep native empty states visible on iOS 16

- **Date:** 2026-08-31
- **Problem:** Expo UI's native `ContentUnavailableView` only renders on iOS 17 and later, while Cradle Mobile supports iOS 16.4. Empty native lists and unavailable content could therefore appear as an unexplained blank screen.
- **Motivation:** An empty state should explain what happened and what the user can do next on every supported iPhone, not silently disappear on the oldest supported release.
- **Product behavior:** Chat activity, Projects, workspace files, pull requests, Usage, and Work now show the same symbol, title, and description on iOS 16 and later. The presentation follows Dynamic Type, semantic colors, centered layout, and VoiceOver-friendly decorative icon handling.
- **Implementation summary:** Added a shared SwiftUI `NativeUnavailableView` built from iOS 16-compatible primitives and replaced every Mobile iOS `ContentUnavailableView` call site. Its SF Symbol name is derived from Expo UI's `Image` props so callers remain type-safe.
- **Files / systems affected:** Mobile native UI primitive and the seven iOS feature views that own empty or unavailable states.
- **Validation performed:** Mobile ESLint; TypeScript typecheck; Expo export for iOS, Android, and Web; source audit confirming no iOS `ContentUnavailableView` usages remain.
- **Tradeoffs:** iOS 17 devices receive a close visual equivalent rather than Apple's exact `ContentUnavailableView`, in exchange for one consistent implementation across the supported system range.
- **Follow-up ideas:** Return to the system component when the deployment target reaches iOS 17, or add an optional action slot when an empty state has a single useful recovery action.
- **Out of scope:** Raising the deployment target, changing feature-specific empty-state copy, or altering Android and Web empty states.
