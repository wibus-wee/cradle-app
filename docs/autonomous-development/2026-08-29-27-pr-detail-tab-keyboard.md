# Navigate PR detail tabs by keyboard

- **Date:** 2026-08-29
- **Problem:** Pull Request detail tabs declared ARIA roles but behaved like unrelated buttons for keyboard and assistive-technology users.
- **Motivation:** Reviewers should move among Summary, Timeline, and Code without leaving the tab control or accumulating extra tab stops.
- **Product behavior:** Left/Right wrap between tabs, Home/End jump to the edges, and focus follows selection. Only the selected tab is in the page tab order.
- **Implementation:** The props-only detail View adds a roving tabindex keyboard handler and explicit tab-to-tabpanel ARIA relationships.
- **Systems affected:** Pull Request detail View and targeted tests.
- **Validation:** Targeted Vitest coverage, web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** Selection follows focus, which is the expected automatic activation model for locally rendered panels.
- **Follow-up ideas:** Persist the active detail tab in navigation state if users commonly reopen the same PR context.
- **Out of scope:** URL routing and configurable shortcuts.
