# Explain blocked Work delivery on Mobile

- **Date:** 2026-08-31
- **Problem:** Mobile silently disabled Work delivery for dirty or commitless checkouts and did not disable it for an unhealthy isolation boundary, even though the server rejects all three states.
- **Motivation:** A disabled handoff action should tell users what must change instead of forcing them to diagnose readiness elsewhere.
- **Product behavior:** The Work detail screen now explains whether delivery needs a healthy isolated checkout, a clean checkout, or at least one commit ahead of the base branch. The submit action follows the same three prerequisites as the server.
- **Implementation:** The fixture-renderable view derives one prioritized explanation directly from the typed readiness contract and reuses it for action availability.
- **Systems affected:** Mobile Work detail view.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Mobile explains readiness but does not attempt to commit or discard repository changes remotely.
- **Follow-up ideas:** Link blockers to safe remediation workflows when those commands have explicit server ownership.
- **Out of scope:** Git mutations, isolation repair, and server changes.
