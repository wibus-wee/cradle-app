# Share pull requests from a native iOS menu

- **Date:** 2026-08-31
- **Problem:** Pull request detail exposed only a direct GitHub button, leaving no Mobile sharing workflow and little room for additional contextual actions in the navigation bar.
- **Motivation:** Pull requests are frequently handed to a teammate from a phone. A standard iOS toolbar menu keeps the header compact and makes the system share sheet one tap away.
- **Product behavior:** The iOS 26 pull request header now has a native actions menu with “Open in GitHub” and “Share Pull Request,” each paired with an SF Symbol. Sharing sends the PR title and URL through the system share sheet; failures are reported in place. Android retains its existing GitHub button.
- **Implementation summary:** Replaced the iOS toolbar button with Expo Router's native `Stack.Toolbar.Menu` and connected React Native's system Share API in the Container, keeping the data-backed action outside the fixture-driven View.
- **Files / systems affected:** Mobile pull request detail Container.
- **Validation performed:** Mobile ESLint; TypeScript typecheck; Xcode 27 generic iOS Simulator Debug build (`BUILD SUCCEEDED`).
- **Tradeoffs:** Opening GitHub now takes one extra tap, while the header gains a scalable native home for multiple actions and avoids competing text buttons.
- **Follow-up ideas:** Add copy-link only if user feedback shows the system share sheet is too heavy for that frequent action.
- **Out of scope:** Pull request editing, browser authentication, and non-Mobile surfaces.
