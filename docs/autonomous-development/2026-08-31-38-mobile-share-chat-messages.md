# Share chat messages from Mobile

- **Date:** 2026-08-31
- **Problem:** Mobile conversations exposed only a small 32-point copy control, so sending a useful response to another app required copying, switching apps, and pasting. The control also fell below Apple's default 44-point touch target.
- **Motivation:** Agent responses often become implementation notes, status updates, or troubleshooting instructions. Sharing directly removes a repetitive handoff while making the existing action affordance easier to hit and use with assistive technology.
- **Product behavior:** Every non-empty user or assistant message now has one-tap Copy and Share actions. Share opens the operating system share sheet with the message text. Copy retains its temporary success state, and both actions report failures. Each action has a 44-point target and a specific accessibility label.
- **Implementation:** Message actions moved into a feature-owned, platform-resolved component. iOS renders real SwiftUI buttons and SF Symbols inside an Expo UI Host; Android and Web use the existing React Native interaction primitive with the same sizing and behavior. `ChatContainer` owns the native Share API while the fixture-renderable chat View receives only callbacks.
- **Systems affected:** Mobile chat Container, transcript View, message rendering, message action components, and chat fixtures.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web.
- **Tradeoffs:** Two visible actions use more vertical space than the previous copy-only control. Keeping them visible preserves one-tap discoverability and avoids hiding a common action behind an overflow menu.
- **Follow-up ideas:** Add message deep links or rich share metadata if Cradle gains a stable externally reachable conversation URL.
- **Out of scope:** Sharing attachments, exporting entire conversations, link generation, message selection, and changing transcript content rendering.
