# Act on Work from a native context menu

- **Date:** 2026-08-31
- **Problem:** Work rows exposed conversation and info actions visually, but iOS users could not use the platform's long-press or iPad pointer workflow to act on a row.
- **Motivation:** A consistent native context menu makes repeated Work navigation faster without adding more permanent controls to an already information-dense list.
- **Product behavior:** Long-pressing or secondary-clicking a Work row now offers Open Conversation and View Work Info. The row and its 44-point info button remain direct, visible entry points.
- **Implementation summary:** Wrapped each existing SwiftUI row in Expo UI's native ContextMenu and reused the View's existing callbacks, preserving the fixture-driven rendering boundary and container-owned navigation.
- **Files / systems affected:** Mobile Work list rendering on iOS.
- **Validation performed:** Targeted Mobile ESLint, TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** The menu contains only the two existing navigation actions. Lifecycle mutations remain on detail surfaces where status and consequences are visible.
- **Follow-up ideas:** Apply the same concise context-menu pattern to workspace rows where the actions remain available elsewhere in the interface.
- **Out of scope:** Work mutations, custom menu previews, Android UI, and desktop/web surfaces.
