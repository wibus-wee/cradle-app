# Let iOS 26 manage the native tab bar

- **Date:** 2026-08-31
- **Problem:** Cradle's Native Tabs forced an opaque custom background and blur treatment, preventing iOS 26 from presenting its native Liquid Glass edge behavior and keeping the bar full-height while reading long lists.
- **Motivation:** The tab bar is persistent chrome on every primary Mobile workflow. Letting the current OS own its material and scrolling behavior makes content feel more at home on iPhone and leaves more room for workspaces, Work, and pull requests.
- **Product behavior:** On iOS 26, the tab bar now uses the system appearance and minimizes when the user scrolls down, then expands when they reverse direction. Android retains its existing themed colors, indicator, and ripple.
- **Implementation summary:** Added the iOS 26 `minimizeBehavior="onScrollDown"` Native Tabs option and moved the previous appearance overrides into the Android-only prop branch.
- **Files / systems affected:** Mobile native tab layout only.
- **Validation performed:** Mobile ESLint; TypeScript typecheck; Xcode 27 generic iOS Simulator Debug build (`BUILD SUCCEEDED`).
- **Tradeoffs:** iOS tab colors now follow the system appearance rather than Cradle-specific chrome tokens; selected-tab tint remains recognizable through the system accent treatment.
- **Follow-up ideas:** Add an iOS 26 bottom accessory only when Cradle has a genuinely persistent cross-tab activity that deserves that space.
- **Out of scope:** Tab information architecture, Android appearance changes, and decorative custom glass replicas.
