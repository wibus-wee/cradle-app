# Open Mobile pull requests on GitHub

- **Date:** 2026-08-31
- **Problem:** Mobile could review and comment on a pull request but offered no path to GitHub for unsupported repository actions.
- **Motivation:** Labels, merge controls, and repository-specific checks sometimes require GitHub, especially during remote review.
- **Product behavior:** Pull request detail now includes an external-link icon that opens the canonical GitHub URL and reports launch failures.
- **Implementation:** `PullRequestDetailContainer` owns Expo Linking access, while the fixture-renderable view owns only the command and local failure alert. A complete detail fixture now covers the touched surface.
- **Systems affected:** Mobile pull request detail and fixtures.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** The action leaves Cradle rather than reproducing GitHub controls that the Mobile contract does not own.
- **Follow-up ideas:** Add native sharing if users frequently hand pull requests to teammates from Mobile.
- **Out of scope:** Merge controls, GitHub authentication changes, and server contract changes.
