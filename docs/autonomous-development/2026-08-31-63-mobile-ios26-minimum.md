# Make iOS 26 the Mobile baseline

- **Date:** 2026-08-31
- **Problem:** Mobile still declared iOS 16.4 support, forcing compatibility branches and substitute UI even though the product now targets current-generation iOS devices only.
- **Motivation:** An iOS 26 baseline lets Cradle use Apple's current native design and interaction APIs directly, keeping the implementation and product language focused instead of spending time on obsolete fallbacks.
- **Product behavior:** Cradle Mobile now requires iOS 26. Empty and unavailable states use Apple's system `ContentUnavailableView`, while material surfaces always use iOS 26 `UIGlassEffect`.
- **Implementation summary:** Updated Expo, CocoaPods, and all Xcode deployment settings to 26.0; regenerated CocoaPods integration; removed the pre-iOS 26 glass fallback and the custom compatibility empty-state component; removed the deprecated `UIRequiresFullScreen` plist key.
- **Files / systems affected:** Mobile app configuration, native iOS project and Pods metadata, the native material view, and iOS feature empty states.
- **Validation performed:** Expo prebuild configuration resolved deployment target 26.0; CocoaPods install; Mobile ESLint; TypeScript typecheck; Xcode 27 generic iOS Simulator Debug build (`BUILD SUCCEEDED`).
- **Tradeoffs:** Devices below iOS 26 can no longer install or update this app. This is intentional product scope, not a temporary compatibility limitation.
- **Follow-up ideas:** Remove other defensive platform branches as they are encountered and prioritize iOS 26-native navigation, materials, menus, controls, and system integrations.
- **Out of scope:** Android minimum versions, desktop compatibility, and unrelated server behavior.
