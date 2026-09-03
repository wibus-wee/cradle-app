# Confirm externally visible pull request reviews on iOS

- **Date:** 2026-08-31
- **Problem:** Approve and Request Changes published an external GitHub review immediately when tapped, making an accidental touch visible to collaborators.
- **Motivation:** Review-state changes deserve a deliberate final step, while ordinary comments should remain fast to submit.
- **Product behavior:** iOS now presents a native confirmation dialog before approving or requesting changes. The dialog explains whether a note will be published and offers an explicit cancel action. Comment submission remains immediate.
- **Implementation summary:** Wrapped the two review-state buttons in Expo UI SwiftUI ConfirmationDialog triggers and kept the existing async submission, disabled, progress, error, and draft-preservation behavior behind the confirmed actions.
- **Files / systems affected:** Mobile iOS pull request review composer only.
- **Validation performed:** Targeted Mobile ESLint, TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** Confirmation adds one tap to the two externally visible review-state transitions. Comments intentionally do not incur that cost.
- **Follow-up ideas:** Preserve unfinished review notes when leaving the pull request detail screen.
- **Out of scope:** Review API semantics, comment confirmation, draft persistence, Android UI, and desktop/web review flows.
