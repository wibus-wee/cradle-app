# Jump to the latest Mobile chat message

- **Date:** 2026-08-31
- **Problem:** After scrolling through a long Mobile conversation, returning to the current response required a long manual scroll through an inverted transcript.
- **Motivation:** Mobile is a live controller, so users need a fast way back to the newest agent output while inspecting history.
- **Product behavior:** A down-arrow appears above the composer after the transcript moves meaningfully away from the latest message. Tapping it animates directly back to current output.
- **Implementation:** The fixture-renderable Chat view owns scroll-distance presentation state and a typed list ref. The fixed-size control is absolutely anchored to the composer so appearing does not reflow messages or input controls.
- **Systems affected:** Mobile Chat view.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Visibility uses a fixed scroll-distance threshold tuned for deliberate navigation, not unread-message semantics.
- **Follow-up ideas:** Add an unread count if the runtime exposes a reliable arrival-versus-viewport boundary.
- **Out of scope:** Read receipts, persisted scroll position, and transcript search.
