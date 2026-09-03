# Recover Mobile chat drafts

- **Date:** 2026-08-31
- **Problem:** Navigating away from a Mobile conversation discarded unsent text and photo attachments.
- **Motivation:** Mobile sessions are frequently interrupted, and retyping a detailed agent prompt is expensive.
- **Product behavior:** Chat drafts now restore per conversation, synchronize through the server-owned composer draft contract, flush when leaving the screen, and clear only after a send, queue, or steer request is accepted.
- **Implementation:** A Mobile draft-sync hook uses the shared `chat:{sessionId}` surface identity, serializes writes, and reuses the established 300 ms edit batch window. The container owns persistence while the view and composer receive typed draft state and callbacks.
- **Systems affected:** Mobile chat container, view, composer, fixture, and a new draft-sync hook.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Mobile currently synchronizes text and photo parts; context parts and pasted-text blocks are preserved by other clients but not authored by the Mobile composer.
- **Follow-up ideas:** Show draft save status only if dogfooding reveals uncertainty despite automatic recovery.
- **Out of scope:** Offline conflict resolution, prompt history, and server contract changes.
