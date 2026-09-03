# Explain pull request readiness on iOS

- **Date:** 2026-08-31
- **Problem:** The native iOS pull request detail showed individual checks but omitted the server's merge readiness and blocker information. A reviewer could approve from Mobile without understanding why delivery was still blocked.
- **Motivation:** Readiness is a decision summary, not another GitHub action. Surfacing it beside the existing change overview lets users assess a pull request before reading every check or leaving Cradle.
- **Product behavior:** The iOS pull request detail now includes a native Readiness section. Merge status is summarized as Ready, Draft, Conflicts, Blocked, Closed, or Merged with semantic color and SF Symbol; aggregate checks show Passed, Failing, Pending, or No checks. Every server-provided merge blocker appears as a separate explanatory row.
- **Implementation:** Presentation maps directly from the generated pull request contract's `canMerge`, `mergeable`, lifecycle, draft, and checks fields. Blocker text remains owned by the server. The section uses SwiftUI labeled content and dynamic system text, and intentionally does not expose GitHub's lower-level `mergeableState` string.
- **Systems affected:** Mobile native iOS pull request detail and autonomous development journal.
- **Validation:** Mobile ESLint and TypeScript passed, and Expo production exports completed for iOS, Android, and Web.
- **Tradeoffs:** Readiness is informational and may change after the next server refresh. Detailed check rows remain the source for individual CI results.
- **Follow-up ideas:** Surface requested reviewers and assignees, and add an explicit refresh gesture if readiness polling needs extend beyond pending checks.
- **Out of scope:** Merge controls, marking a draft ready, server/API changes, inferred blocker text, Android/Web presentation changes, and automatic review decisions.
