# Search the Mobile pull request inbox

- **Date:** 2026-08-31
- **Problem:** Mobile users had to scan every authored or review-request pull request to find a specific change.
- **Motivation:** Repository names and PR numbers are often the fastest identifiers during remote review.
- **Product behavior:** The selected Mobile PR inbox now filters immediately by title, owner, repository, or `#number` and provides a useful no-match state.
- **Implementation:** `PullRequestListView` owns transient search state and filters its existing authored or reviewing fixture data before date grouping.
- **Systems affected:** Mobile pull request list UI only.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Search is scoped to the selected authored or review-request mode so results keep their inbox meaning.
- **Follow-up ideas:** Add repository facets if search alone proves slow for users with very large inboxes.
- **Out of scope:** GitHub server search, closed pull requests, and persisted queries.
