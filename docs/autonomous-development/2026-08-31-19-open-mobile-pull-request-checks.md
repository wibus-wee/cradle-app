# Open pull request checks on Mobile

- **Date:** 2026-08-31
- **Problem:** Pull request checks showed names and conclusions on Mobile but could not open their CI details.
- **Motivation:** A failed check is actionable only when users can quickly inspect its logs and annotations.
- **Product behavior:** Checks with an authoritative URL now display an external-link affordance and open their details; URL-less checks remain non-interactive.
- **Implementation:** The PR detail container exposes a generic URL-opening callback, and the fixture-renderable view maps both the PR header and linked checks through it with contextual failure feedback.
- **Systems affected:** Mobile pull request detail container, view, and fixture contract.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Check details open outside Cradle because the Mobile API does not own CI log rendering.
- **Follow-up ideas:** Add rerun controls only when the server exposes permission-aware CI mutations.
- **Out of scope:** Rerunning checks, inline log rendering, and server changes.
