# Pin conversations from the native workspace list

- **Date:** 2026-08-31
- **Problem:** Mobile users could see which conversations were pinned, but changing that state required opening the conversation and using its toolbar.
- **Motivation:** Pinning is a lightweight list-management action. Keeping it in the workspace list makes recurring conversations faster to organize with a familiar iOS gesture.
- **Product behavior:** Swiping a conversation row reveals a native Pin or Unpin action. After it succeeds, pinned conversations move to the top and related workspace, chat, and unread state stays in sync. A failed update explains that the setting was not changed.
- **Implementation summary:** Wrapped iOS conversation rows in Expo UI's SwiftUI `SwipeActions`, connected the action through the existing fixture-driven View contract, and reused the session PATCH endpoint. The Container refreshes the workspace query and synchronizes related query caches after success.
- **Files / systems affected:** Mobile workspace detail View and Container, its typed contract, and fixture.
- **Validation performed:** Mobile ESLint; TypeScript typecheck; Expo export for iOS, Android, and Web.
- **Tradeoffs:** Full-swipe execution is disabled to reduce accidental state changes; the user must tap the revealed action. Other platforms keep their existing interaction for now.
- **Follow-up ideas:** Add a discoverable context-menu equivalent if list actions grow, or expose archiving only after its recovery behavior is designed.
- **Out of scope:** New server endpoints, conversation deletion or archiving, and changes outside Mobile.
