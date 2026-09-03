# Copy Mobile chat messages

- **Date:** 2026-08-31
- **Problem:** Native and Android Markdown renderers did not provide one reliable way to copy a complete chat message.
- **Motivation:** Users frequently move agent output into issues, terminals, notes, and other Mobile apps.
- **Product behavior:** User and assistant messages with visible text now expose a compact copy icon that changes to a success check and reports clipboard failures.
- **Implementation:** `ChatContainer` owns Expo Clipboard access, while `ChatMessage` derives only visible text parts and owns transient interaction feedback.
- **Systems affected:** Mobile chat container, view, message renderer, and fixture contract.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Copy intentionally excludes reasoning and tool payloads that are not visible message text.
- **Follow-up ideas:** Add a native share action if clipboard handoff is insufficient during dogfooding.
- **Out of scope:** Copying hidden activity data, rich-text clipboard formats, and server changes.
