# Open GitHub from the native pull request toolbar

- **Date:** 2026-08-31
- **Problem:** Pull request detail combined a generic system navigation title with a second in-content title row containing its GitHub action, creating duplicate hierarchy and a custom toolbar control.
- **Motivation:** Opening the source pull request is the primary external action on this screen. A trailing system toolbar item keeps it consistently available and gives iOS the standard symbol, material, press, and accessibility behavior.
- **Product behavior:** Native pull request detail uses the pull request number as its system title and exposes GitHub in the trailing toolbar. iOS renders the `safari` SF Symbol and Android renders a clear text action. Repository context and draft/open status remain visible immediately below the native header. Web retains the complete inline title and action row.
- **Implementation:** The data-owning Container configures the native Stack title and toolbar after detail loads, and owns link failure feedback. The fixture-renderable View receives an explicit native-header flag, keeping platform and routing dependencies outside the View while sharing the same content model.
- **Systems affected:** Mobile pull request detail Container and View, plus the shared `Screen` native-header context row.
- **Validation:** Mobile TypeScript, ESLint, and Expo production exports for iOS, Android, and Web.
- **Tradeoffs:** Expo's composed Stack toolbar is still an alpha API. Status remains content metadata rather than a navigation-bar subtitle because the current Expo navigation contract does not expose the iOS 26 subtitle API.
- **Follow-up ideas:** Move other detail-only external actions into native toolbars when their primary workflow is clear.
- **Out of scope:** Pull request content reordering, review submission, comments, GitHub authentication, and server changes.
