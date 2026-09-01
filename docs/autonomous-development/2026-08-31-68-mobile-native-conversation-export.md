# Share conversation exports from native iOS actions

- **Date:** 2026-08-31
- **Problem:** Cradle could already export a session transcript or complete archive, but Mobile users had no way to reach either workflow.
- **Motivation:** Conversation output is useful outside Cradle for handoff, review, and record keeping; iOS already provides the appropriate destination picker through the system share sheet.
- **Product behavior:** The iOS 26 conversation toolbar now offers Share Transcript for a Markdown file and Export Archive for a ZIP containing the transcript and session metadata. Both actions are unavailable while a response is active, preventing incomplete exports, and preparation failures produce an alert.
- **Implementation summary:** Added a native toolbar menu backed by the existing authenticated session export endpoints. Exports are written to Cradle's cache and handed to the iOS share sheet without adding persistent app storage.
- **Files / systems affected:** Mobile Chat container, iOS native conversation toolbar, and Mobile cache-based sharing.
- **Validation performed:** Targeted Mobile ESLint, TypeScript typecheck, Expo public config generation, and diff whitespace validation.
- **Tradeoffs:** Export files use stable descriptive filenames instead of the conversation title, avoiding filesystem sanitization rules and keeping the workflow deterministic. Cached exports are intentionally transient.
- **Follow-up ideas:** Add a native progress surface if export archives grow large enough for preparation time to become noticeable in dogfooding.
- **Out of scope:** Server export formats, export history, persistent downloads, Android UI, and desktop/web surfaces.
