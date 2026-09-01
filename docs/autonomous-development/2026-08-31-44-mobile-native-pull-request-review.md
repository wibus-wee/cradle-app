# Review pull requests with native iOS controls

- **Date:** 2026-08-31
- **Problem:** Pull request comments and reviews used a generic multiline input plus three app-styled actions. All actions showed the same loading state, failures were easy to miss, and Approve appeared enabled without a note but silently did nothing.
- **Motivation:** Review submission is a consequential Mobile workflow. Native input and buttons improve keyboard behavior, Dynamic Type, touch sizing, progress clarity, and semantic emphasis while preserving the surrounding Markdown and pull request context.
- **Product behavior:** iOS now edits an optional review note in a native expanding TextField and submits Comment, Request Changes, or Approve through 44-point SwiftUI actions with SF Symbols and action-specific progress. Comment and Request Changes require text; Approve can be submitted without a note, matching the existing API capability. All controls disable during submission, failed drafts remain intact, and errors appear beside the editor. Android and Web retain the existing form appearance with the corrected submission behavior.
- **Implementation:** The editor moved into platform-resolved fixture-driven `PullRequestReviewComposer` Views with a shared typed contract. The parent pull request View continues to own detail presentation while its Container owns mutations. Local pending-action state identifies the exact operation in progress, and the native Host sizes vertically inside the existing detail scroll surface.
- **Systems affected:** Mobile pull request detail View, review composer platform Views, shared composer contract, and pull request fixtures.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web.
- **Tradeoffs:** The review composer remains inline at the end of the detail page so users retain nearby timeline context; it is not a separate modal sheet. The iOS Host uses content-matched height and should be dogfooded with the largest Dynamic Type sizes.
- **Follow-up ideas:** Measure whether reviewers want a persistent header Review action that scrolls directly to the composer before introducing another modal workflow.
- **Out of scope:** Merge actions, inline code comments, review threads, Markdown editing, PR detail redesign, and server endpoint changes.
