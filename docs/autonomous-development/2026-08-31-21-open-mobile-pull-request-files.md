# Open pull request files on Mobile

- **Date:** 2026-08-31
- **Problem:** Changed-file rows in Mobile pull request details showed useful statistics but could not be opened.
- **Motivation:** Reviewers often need to inspect the exact source around a change before commenting or approving from a phone.
- **Product behavior:** Every changed-file row now has an external-link affordance and opens the file at the pull request revision on GitHub. Opening failures produce contextual feedback.
- **Implementation:** The fixture-renderable detail view routes the server-provided file `blobUrl` through its existing external-navigation callback.
- **Systems affected:** Mobile pull request detail view.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Source opens outside Cradle, preserving GitHub's full code navigation without introducing a partial Mobile code viewer.
- **Follow-up ideas:** Add an in-app patch preview for focused review when large diffs can be presented accessibly.
- **Out of scope:** Inline diff rendering, file comments, and server changes.
