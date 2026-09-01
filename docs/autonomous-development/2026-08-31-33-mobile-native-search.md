# Search Mobile lists with the native header

- **Date:** 2026-08-31
- **Problem:** Workspaces, Work, and pull requests each rendered a custom search field inside content, consuming vertical space and bypassing native search behavior.
- **Motivation:** These are high-volume collections. System search provides familiar focus, cancellation, keyboard, accessibility, and scroll coordination while keeping filtering immediately available.
- **Product behavior:** Native builds now place search below the system title on all three collection tabs. The search field scrolls with the navigation header, filters the same fields as before, clears when cancelled, and remains scoped to its tab. Web retains the existing inline search controls.
- **Implementation:** A searchable route page owns the query and configures Expo Router's native `Stack.SearchBar`. It passes controlled search state through each Container to the fixture-renderable View. Views select between native-header and inline presentation without importing routing or global state.
- **Systems affected:** Mobile top-level route shells, Workspaces, Work, and pull request list Containers, Views, and fixtures.
- **Validation:** Mobile TypeScript, ESLint, and Expo production exports for iOS, Android, and Web.
- **Tradeoffs:** Search remains in-memory and resets when its route is unmounted. Native and Web use different controls but share one typed query contract and matching behavior.
- **Follow-up ideas:** Add result counts to native search states or promote a dedicated search tab only if cross-domain search becomes a primary workflow.
- **Out of scope:** Server-side search, fuzzy ranking, search history, cross-domain results, and Settings search.
