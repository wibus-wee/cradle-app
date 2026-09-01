# Open pull request conversations on Mobile

- **Date:** 2026-08-31
- **Problem:** Mobile displayed pull request comments and reviews without linking back to their authoritative GitHub context.
- **Motivation:** Review discussion often depends on surrounding thread context, reactions, or line-level annotations that the compact Mobile timeline does not reproduce.
- **Product behavior:** URL-backed conversation events now show an external-link affordance and open their GitHub location. Events without a URL remain readable and non-interactive.
- **Implementation:** Timeline pressability stays inside the fixture-renderable view and uses the existing external-navigation callback and contextual failure feedback.
- **Systems affected:** Mobile pull request detail view.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Detailed thread context opens outside Cradle instead of duplicating GitHub's review UI.
- **Follow-up ideas:** Support inline replies when the API exposes thread-aware mutations.
- **Out of scope:** Replies, reactions, thread resolution, and server changes.
