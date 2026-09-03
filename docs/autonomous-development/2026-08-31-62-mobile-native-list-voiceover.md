# Give native Mobile lists clear VoiceOver semantics

- **Date:** 2026-08-31
- **Problem:** Complex native list rows visually combined titles, status icons, timestamps, and metadata, but left VoiceOver to infer their order and meaning from nested SwiftUI content.
- **Motivation:** Workspaces, conversations, Work, and pull requests are the app's primary navigation surfaces. Their spoken experience should be as intentional as their visual hierarchy.
- **Product behavior:** Each primary row now announces a concise label, a structured value containing its useful state, and a hint describing the result of activation. Decorative symbols no longer interrupt the intended reading order.
- **Implementation summary:** Added SwiftUI accessibility label, value, and hint modifiers at the native Button boundary while continuing to derive all content from existing typed View props.
- **Files / systems affected:** Mobile iOS workspace, workspace detail, Work list, and pull request list Views.
- **Validation performed:** Mobile ESLint; TypeScript typecheck; Expo export for iOS, Android, and Web.
- **Tradeoffs:** Explicit announcements duplicate visible copy in code, but produce stable, meaningful output instead of relying on SwiftUI's automatic concatenation of nested labels.
- **Follow-up ideas:** Audit native detail forms and custom chat transcript navigation with VoiceOver on an iOS 26 device.
- **Out of scope:** Visual redesign, server changes, and non-Mobile surfaces.
