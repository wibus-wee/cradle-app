# Inspect chat activity in a native iOS sheet

- **Date:** 2026-08-31
- **Problem:** Chat tool and reasoning details opened in a single-height React Native page sheet whose hierarchy, scrolling, status treatment, and empty state were all custom-drawn.
- **Motivation:** Activity is supporting context that users often glance at without leaving the conversation. A native resizable sheet keeps that relationship clear and lets iOS own detents, drag behavior, scroll coordination, Dynamic Type, and system status affordances.
- **Product behavior:** iOS opens Activity at a compact 55-percent detent and can expand it to 90 percent or dismiss it with the system gesture. A native grouped form separates reasoning and individual tool calls, shows live progress and semantic completed/failed states, preserves selectable reasoning and payload text, and provides native loading, error, empty, and Done affordances. Android and Web retain the existing page-sheet presentation.
- **Implementation:** A platform-specific `ChatActivitySheet.ios.tsx` combines Expo UI's native bottom sheet with SwiftUI Form components and SF Symbols. The platform views share a typed props contract plus activity filtering and safe payload serialization, and an isolated fixture now exercises the surface without chat runtime dependencies.
- **Systems affected:** Mobile Chat activity sheet, activity rendering contract/model, and Chat fixtures.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web.
- **Tradeoffs:** The sheet uses two predictable detents rather than content-sized presentation so verbose tool payloads always have a stable scroll area. Native Expo UI components require a development or production build rather than Expo Go.
- **Follow-up ideas:** Dogfood very large payloads and add per-payload copy actions only if text selection proves too slow for frequent debugging.
- **Out of scope:** Activity data fetching, tool approval or retry actions, payload syntax highlighting, Android sheet migration, and Chat Composer changes.
