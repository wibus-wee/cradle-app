# Open mobile pull requests in GitHub

- **Date:** 2026-08-31
- **Problem:** Mobile pull-request detail could comment and review through Cradle but offered no path to GitHub for full diffs, checks, or provider-specific actions.
- **Motivation:** Mobile review often needs a quick handoff to the installed GitHub app or browser while preserving Cradle's focused control workflow.
- **Product behavior:** Pull-request detail now shows an accessible external-link icon beside status. It opens the canonical response URL with the device link handler and displays an alert if no handler can open it.
- **Implementation summary:** Added an external-open callback to the fixture-driven detail View, kept React Native `Linking` and `Alert` in the Container, and added a complete owner-typed detail fixture.
- **Files / systems affected:** Mobile pull-request detail View/container/fixtures, mobile architecture documentation, and autonomous journal.
- **Validation performed:** Mobile TypeScript checking, ESLint on changed source files, and diff validation.
- **Tradeoffs:** The action delegates destination choice to the operating system and does not construct or validate provider URLs locally. It is intentionally GitHub-specific because the current pull-request owner and API are GitHub-specific.
- **Follow-up ideas:** Add focused in-app file diffs only after the mobile review surface has a scalable patch rendering strategy.
