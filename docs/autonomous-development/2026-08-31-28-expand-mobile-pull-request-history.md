# Expand pull request history on Mobile

- **Date:** 2026-08-31
- **Problem:** Mobile reported the full pull request conversation count but silently rendered only the newest 20 events.
- **Motivation:** Older review decisions and context must remain reachable, while the default detail screen should stay compact on long-running pull requests.
- **Product behavior:** Pull requests with more than 20 events now offer a control to reveal all earlier events and collapse back to the latest 20.
- **Implementation:** The fixture-renderable detail view owns the local presentation toggle and derives the visible slice from its typed detail prop.
- **Systems affected:** Mobile pull request detail view.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Expanding renders the complete server response at once; the default remains bounded for normal phone navigation.
- **Follow-up ideas:** Add server pagination if conversation payloads grow beyond practical response sizes.
- **Out of scope:** Server pagination, event filtering, and thread mutations.
