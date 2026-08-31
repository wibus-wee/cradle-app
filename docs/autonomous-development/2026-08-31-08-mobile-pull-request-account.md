# Identify the Mobile pull request account

- **Date:** 2026-08-31
- **Problem:** The Mobile PR inbox showed personalized authored and review queues without identifying the GitHub account they belonged to.
- **Motivation:** Users with multiple GitHub identities need immediate context before acting on review requests.
- **Product behavior:** The pull request inbox header now shows the authenticated GitHub login beneath its title.
- **Implementation:** `PullRequestListView` renders the existing typed `login` prop already supplied by its container and fixtures.
- **Systems affected:** Mobile pull request list UI only.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** The login is informational; GitHub authentication continues to be configured on Cradle Desktop.
- **Follow-up ideas:** Link to account troubleshooting if dogfooding shows frequent identity mismatches.
- **Out of scope:** Account switching, authentication setup, and server contract changes.
