# Restore unfinished pull request review notes on iOS

- **Date:** 2026-08-31
- **Problem:** Leaving a pull request detail screen discarded an unfinished review note, making interruption-prone Mobile review unnecessarily risky.
- **Motivation:** Review notes often contain careful feedback and should survive navigation, app suspension, or an accidental back gesture.
- **Product behavior:** iOS saves review-note edits after 300 milliseconds and restores them when the same pull request is reopened. Drafts are isolated by Cradle Server, repository, and pull request number. A successful comment or review clears the saved note; failed submissions keep it.
- **Implementation summary:** Added an iOS AsyncStorage adapter, a container-owned debounced persistence hook with query-cache synchronization, and optional initial-draft/change callbacks on the existing fixture-driven review View contract. The non-iOS adapter remains a no-op.
- **Files / systems affected:** Mobile iOS pull request detail, review composer state, and device-local storage.
- **Validation performed:** Targeted Mobile ESLint, TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** Drafts are device-local and do not sync to Desktop or another iPhone. Storage failures are intentionally silent so they never block review submission.
- **Follow-up ideas:** Add an explicit discard affordance if users need to clear a note without submitting it.
- **Out of scope:** Server draft schema changes, Work handoff drafts, Android/web persistence, and cross-device sync.
