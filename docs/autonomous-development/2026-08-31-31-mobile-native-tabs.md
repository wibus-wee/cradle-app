# Navigate Mobile with native tabs

- **Date:** 2026-08-31
- **Problem:** Mobile hid its four top-level destinations in a header menu, making navigation slower and less discoverable than the platform-standard tab pattern.
- **Motivation:** Workspaces, Work, pull requests, and settings are peer destinations used throughout a session. Keeping them visible reduces navigation effort and lets the operating system preserve each destination's navigation state.
- **Product behavior:** Native builds now show a persistent four-item system tab bar with SF Symbols on Apple platforms and Material Symbols on Android. The selected state, system material, dark mode, tab reselection behavior, and accessibility semantics come from the platform. Web keeps its existing stack layout.
- **Implementation:** The native Expo Router layout owns the tab hierarchy. Top-level fixture-renderable views no longer receive or render application navigation controls, and the root navigation theme uses the Mobile design tokens to prevent mismatched transition backgrounds.
- **Systems affected:** Mobile native routing, navigation theme, top-level Workspaces, Work, pull request, and Settings view contracts and fixtures.
- **Validation:** Mobile TypeScript, ESLint, and Expo production exports for iOS, Android, and Web.
- **Tradeoffs:** Expo Router Native Tabs is an alpha API in SDK 57. A small typed adapter compensates for its missing `children` declaration under TypeScript 6 and has an explicit removal condition in the native layout.
- **Follow-up ideas:** Move top-level page titles and primary actions into native iOS navigation bars, then evaluate native search placement and iPad sidebar adaptation as separate changes.
- **Out of scope:** Detail-screen navigation, page content redesign, SwiftUI content controls, badges, and server changes.
