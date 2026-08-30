# Force-refresh mobile pull request feeds

- **Date:** 2026-08-31
- **Problem:** Pull-to-refresh on the mobile PR list only refetched Cradle projections, so it could complete successfully without requesting new authored or review-request state from GitHub.
- **Motivation:** A manual refresh gesture must reconcile the external source users believe they are refreshing.
- **Product behavior:** Pulling down on the PR list now force-refreshes both GitHub feeds for the authenticated viewer, then reloads the displayed projections. A native alert reports failures without discarding the current list.
- **Implementation:** The list container sends the loaded viewer login to the server-owned `/pull-requests/refresh` endpoint before refetching its existing combined query. The props-only list View and its refresh seam are unchanged.
- **Systems affected:** Mobile PR list container and mobile architecture documentation.
- **Validation:** Mobile typecheck, targeted ESLint, and diff whitespace checks.
- **Tradeoffs:** Manual refresh performs upstream and projection requests sequentially so stale projections cannot race ahead of GitHub reconciliation.
- **Follow-up ideas:** Share one container helper if a third mobile GitHub refresh surface adopts the same failure contract.
- **Out of scope:** Pagination, automatic feed polling, background refresh, and list View changes.
