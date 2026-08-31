# Orient Mobile with native large titles

- **Date:** 2026-08-31
- **Problem:** Top-level Mobile pages still drew their own title area inside content, so native builds could not use iOS large-title transitions or place global activity navigation in the system toolbar.
- **Motivation:** A system navigation bar keeps location and actions visually distinct from content, responds correctly as content scrolls, and adapts to Apple platform changes without recreating those behaviors in React Native.
- **Product behavior:** Each native tab now opens its own stack with a large title that collapses on scroll. Usage is a clearly labeled trailing toolbar action, rendered with the `chart.bar.xaxis` SF Symbol on iOS. Secondary context such as the active GitHub login remains in content below the system title. Web retains the existing inline title and branded Usage control.
- **Implementation:** File-based tab routes now contain nested stacks, matching Expo Router's required native-tab structure. A route-owned page wrapper configures the toolbar, while the fixture-renderable Views continue to provide semantic titles to `Screen`; `Screen` suppresses only their native inline rendering. Virtualized lists opt into automatic content insets so the system can coordinate scrolling with the large title.
- **Systems affected:** Mobile tab route hierarchy, shared screen shell, top-level page shell, Workspaces and Work lists, and the four top-level Views.
- **Validation:** Mobile TypeScript, ESLint, and Expo production exports for iOS, Android, and Web.
- **Tradeoffs:** Expo's composed stack toolbar remains an alpha API. The Android toolbar uses a text label because the composed API accepts SF Symbols only on iOS and image assets on Android.
- **Follow-up ideas:** Move contextual detail-screen actions into native toolbars and adopt native search presentation where it improves a specific high-volume list.
- **Out of scope:** Detail-screen headers, tab badges, native search, list styling, and server changes.
