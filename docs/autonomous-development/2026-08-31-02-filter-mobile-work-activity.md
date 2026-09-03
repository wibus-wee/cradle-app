# Focus Mobile Work by activity

- **Date:** 2026-08-31
- **Problem:** Running, waiting, and blocked Work shared one chronological list, making urgent remote-control tasks hard to isolate.
- **Motivation:** Mobile is most valuable when it quickly answers what is running and what needs the user's attention.
- **Product behavior:** The Mobile Work screen now switches between all Work, running Work, and attention items. Attention includes both waiting and blocked activity, and the mode composes with search.
- **Implementation:** The fixture-renderable `WorkListView` derives activity subsets from the existing Work activity contract before date grouping.
- **Systems affected:** Mobile Work list UI only.
- **Validation:** Mobile TypeScript and ESLint checks.
- **Tradeoffs:** Waiting and blocked items intentionally share one attention mode to keep the control usable at phone widths.
- **Follow-up ideas:** Add a notification surface if users need proactive attention alerts rather than an on-demand view.
- **Out of scope:** Server activity semantics, push notifications, and persisted filter state.
