# Preserve failed Mobile review drafts

- **Date:** 2026-08-31
- **Problem:** Mobile cleared a comment before the server confirmed it and provided no feedback when comments or reviews failed.
- **Motivation:** Losing typed review text on an unreliable remote connection is costly and undermines trust in Mobile workflows.
- **Product behavior:** Comment and review actions now retain text until submission succeeds, clear it after confirmation, and explain failures while preserving the draft for retry.
- **Implementation:** Detail view callbacks now return promises backed by the container's `mutateAsync` operation, allowing the view to own draft lifecycle without reading React Query state directly.
- **Systems affected:** Mobile pull request detail, container, and fixture contracts.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Drafts survive request failures but not route unmounts or app termination.
- **Follow-up ideas:** Persist review drafts if dogfooding shows users commonly leave the detail screen mid-review.
- **Out of scope:** Offline submission queues, cross-device drafts, and server changes.
