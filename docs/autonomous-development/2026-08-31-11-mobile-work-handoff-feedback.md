# Confirm Mobile Work handoffs

- **Date:** 2026-08-31
- **Problem:** Saving Work handoff metadata or creating a draft pull request produced no success or failure feedback on Mobile.
- **Motivation:** Remote delivery actions need explicit confirmation so users do not repeat submissions or assume unsaved metadata is durable.
- **Product behavior:** Save and submit actions now confirm success, explain failures, and retain all handoff fields for retry. Editing a field clears stale feedback.
- **Implementation:** Work detail callbacks now return promises backed by `mutateAsync`; the fixture-renderable view owns command feedback without importing React Query. A typed detail fixture now covers the touched surface.
- **Systems affected:** Mobile Work detail container, view, and fixture contracts.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Feedback is local to the mounted detail screen rather than retained across navigation.
- **Follow-up ideas:** Add durable draft persistence if incomplete handoffs are commonly resumed later.
- **Out of scope:** Automatic retries, offline queues, and server contract changes.
