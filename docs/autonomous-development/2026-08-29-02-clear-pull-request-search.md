# Clear pull request search in place

- **Date:** 2026-08-29
- **Problem:** Removing a long pull request query required selecting and deleting the text manually.
- **Motivation:** Search is a high-frequency navigation tool and should be reversible with one click.
- **Product behavior:** A labelled clear button appears inside the search field while it contains text and keeps focus in the field after clearing.
- **Implementation:** The existing fixture-driven view reuses its local search state and input ref.
- **Systems affected:** Pull request list search and translations.
- **Validation:** Web typecheck, ESLint pre-commit hook, and locale key parity.
- **Tradeoffs:** The control is hidden for an empty query so it does not compete with the keyboard hint.
- **Follow-up ideas:** None unless search moves to server-side filtering.
- **Out of scope:** Filter resets and search history.
