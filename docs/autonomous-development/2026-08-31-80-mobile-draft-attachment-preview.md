# Preview Chat draft attachments with iOS Quick Look

- **Date:** 2026-08-31
- **Problem:** Chat attachments could only be checked through small composer thumbnails, making scanned text, page framing, and document contents difficult to verify before sending.
- **Motivation:** Sending the wrong page or an unreadable capture is costly in an agent conversation. A preflight preview should use the same familiar system behavior as Files and Mail.
- **Product behavior:** On iOS, tapping any draft attachment now opens it in Quick Look. Images can be inspected full-screen and supported documents use their native system preview. The draft and remove controls remain unchanged after dismissal, while an inline spinner communicates that the preview is opening.
- **Implementation summary:** Added a typed preview callback across the Chat View seam so the Container owns file-system and native-module access. Base64 draft data is written to an isolated cache file, previewed with the existing Quick Look module, and removed after dismissal. Quick Look now resolves its bridge call on dismissal and rejects overlapping presentations.
- **Files / systems affected:** Mobile Chat composer/View/Container seams and the iOS Quick Look module.
- **Validation performed:** Targeted Mobile ESLint, Mobile TypeScript typecheck, an unsigned Xcode 27 iOS 26 Simulator build, and diff whitespace validation.
- **Tradeoffs:** Quick Look requires a temporary local file, so opening a large attachment briefly duplicates its data in the cache. Cleanup happens immediately after the system preview closes.
- **Follow-up ideas:** Add Quick Look previews to attachments in already-sent messages when the chat protocol exposes their downloadable payloads.
- **Out of scope:** Custom image zoom UI, attachment editing, previewing remote message attachments, and non-iOS behavior.
