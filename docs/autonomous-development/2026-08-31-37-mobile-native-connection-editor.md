# Edit connections with native iOS fields

- **Date:** 2026-08-31
- **Problem:** The Server and Authentication editors still used a custom cross-platform field and an unlabeled checkmark action on iOS, even after Settings itself became a native form.
- **Motivation:** Connection details are infrequent but sensitive inputs. Native fields provide familiar keyboard behavior, secure text handling, Dynamic Type, and an explicit Save action that is easier to understand than a custom icon.
- **Product behavior:** iOS edits the Server address in a SwiftUI URL field and the access token in a SwiftUI secure field. Both focus on entry, suppress correction and capitalization, and submit from the keyboard's Done key. Save is a native trailing toolbar action, disables for an empty Server or during validation, and changes to “Saving…” while work is in progress. Native form footers explain each value and validation failures appear as a system-styled error row. Android and Web retain their existing layout while also accepting keyboard submission.
- **Implementation:** An iOS-specific fixture-renderable `ConnectionSettingsView` uses Expo UI observable state and SwiftUI `Form`, `TextField`, and `SecureField` primitives. A platform-neutral View contract carries value, validation feedback, and submit callbacks. The Container continues to own normalization, server validation, persistence, routing, and toolbar state.
- **Systems affected:** Mobile connection editor Container, platform Views, shared View contract, and Settings fixtures.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web. The native editor's explanatory copy is present only in the generated iOS bundle, confirming platform-specific resolution.
- **Tradeoffs:** Expo UI's SwiftUI fields remain beta and require a development or production native build. Saving still validates the complete connection before returning, so a slow or unavailable Server can keep this screen active.
- **Follow-up ideas:** Add a deliberate visibility control for an existing access token if dogfooding shows that verification is valuable enough to justify the added exposure risk.
- **Out of scope:** Changing connection validation, storing multiple Servers, credential discovery, Android-native form migration, and connection setup onboarding.
