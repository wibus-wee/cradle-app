# Refresh pull request detail on mobile

- **Date:** 2026-08-31
- **Problem:** Mobile pull request detail stopped polling after checks became terminal, leaving new comments, reviews, or changed GitHub state stale with no manual refresh path.
- **Motivation:** Mobile is a remote review controller; users need a trustworthy way to reconcile the current PR before commenting or approving.
- **Product behavior:** Pulling down on PR detail forces an upstream GitHub refresh and reloads the full detail. A native alert explains refresh failures while preserving the currently displayed PR.
- **Implementation:** The fixture-driven detail View receives refresh state and callback props through the shared Screen refresh seam. Its container calls the server-owned per-PR refresh endpoint with `force: true`, then refetches detail; background check polling does not drive the manual spinner.
- **Systems affected:** Mobile PR detail View/container and mobile architecture documentation.
- **Validation:** Mobile typecheck, targeted ESLint, and diff whitespace checks.
- **Tradeoffs:** Refresh performs two requests so the server remains the owner of GitHub reconciliation and the existing detail query remains the only detail-data path.
- **Follow-up ideas:** Add an explicit last-refreshed timestamp only if users still report uncertainty after dogfooding.
- **Out of scope:** Automatic polling after terminal checks, browser handoff, sharing, and new review actions.
