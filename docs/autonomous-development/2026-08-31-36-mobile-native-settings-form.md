# Use a native iOS Settings form

- **Date:** 2026-08-31
- **Problem:** Mobile Settings used the same custom card-and-row surface on every platform, so iOS missed the familiar grouped form, system typography, semantic colors, and native control behavior users expect from a settings screen.
- **Motivation:** Settings is a contained, action-oriented surface and a good first content-level SwiftUI migration. A native form improves information hierarchy, Dynamic Type behavior, touch handling, and visual consistency with iOS without changing product semantics.
- **Product behavior:** iOS presents Usage, connection health, server actions, authentication, and disconnect in an inset-grouped system form. Rows use SF Symbols, secondary labels, a native progress indicator, system disclosure affordances, and a destructive disconnect action. Tapping connection health checks it again; copy, share, edit, and confirmation behavior is unchanged. Android and Web keep the existing interface.
- **Implementation:** An iOS-specific fixture-renderable `SettingsView` composes Expo UI's SwiftUI `Host`, `Form`, `Section`, and `Button` primitives. The shared props contract keeps queries, navigation, persistence, and sharing in `SettingsContainer`; platform resolution chooses the native View only for iOS.
- **Systems affected:** Mobile Settings View, its platform-neutral props contract, and Settings fixtures.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web. The generated iOS bundle contains the native-form copy while the Android bundle does not, confirming platform-specific resolution.
- **Tradeoffs:** Expo UI's SwiftUI layer is beta and requires a development or production native build rather than Expo Go. The first migration intentionally uses standard system styling instead of reproducing every existing brand treatment.
- **Follow-up ideas:** Dogfood the native form in a development build, then migrate other bounded iOS configuration surfaces where system controls clearly outperform custom React Native equivalents.
- **Out of scope:** New settings, connection-state changes, native forms on Android, and broad conversion of list or detail screens to SwiftUI.
