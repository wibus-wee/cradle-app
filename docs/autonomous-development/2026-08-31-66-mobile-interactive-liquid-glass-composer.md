# Make the Chat composer interactive Liquid Glass

- **Date:** 2026-08-31
- **Problem:** The Chat composer used a hand-built UIKit glass background whose `UIGlassEffect` was explicitly non-interactive, so the most important floating control surface did not respond like an iOS 26 control.
- **Motivation:** Apple positions Liquid Glass as the interactive layer directly beneath the user's fingertips. The primary message composer should gain the system's scale, bounce, and shimmer behavior instead of presenting a static visual imitation.
- **Product behavior:** Chat controls now live inside an interactive iOS 26 GlassView. The Work composer retains its current layout and animation while its background also uses the maintained system GlassView implementation.
- **Implementation summary:** Rebased `NativeMaterialView` on Expo's official `expo-glass-effect`, added the typed `isInteractive` option, made the Chat composer a real glass content container, and removed Cradle's duplicate UIKit module and synthetic sheen layer. Non-iOS continues to render a plain View without leaking iOS-only props.
- **Files / systems affected:** Mobile material primitive, Chat composer, and native inline-module sources.
- **Validation performed:** Mobile ESLint; TypeScript typecheck; CocoaPods regeneration; Xcode 27 generic iOS Simulator Debug build (`BUILD SUCCEEDED`). Product behavior follows Apple's [WWDC25 UIKit guidance](https://developer.apple.com/videos/play/wwdc2025/284/) for interactive custom glass.
- **Tradeoffs:** The official system material replaces Cradle's custom sheen, so exact highlights are owned by iOS and can evolve with the platform. Work composer's animated shell remains a static glass background until its layout is restructured safely.
- **Follow-up ideas:** Move Work composer controls into the same interactive GlassView once its multi-stage animated container can preserve child measurement and gesture ownership.
- **Out of scope:** Decorative glass elsewhere, custom glass animations, and non-Mobile UI.
