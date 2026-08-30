# Copy pull request links

- **Date:** 2026-08-29
- **Problem:** Pull request details could open GitHub but could not copy the canonical link for handoff.
- **Motivation:** Sharing the current review target is a common collaboration action and should not require leaving Cradle.
- **Product behavior:** The detail toolbar copies the canonical GitHub URL and changes to a confirmation icon and accessible label.
- **Implementation:** The fixture-driven detail View owns acknowledgement state; the query container provides the clipboard callback.
- **Systems affected:** Pull request detail View/container and translations.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** Confirmation persists for the lifetime of the selected detail panel rather than adding a toast.
- **Follow-up ideas:** None unless a richer share workflow is introduced.
- **Out of scope:** Link shortening and team share destinations.
