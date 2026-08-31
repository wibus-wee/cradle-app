# Connect to Cradle with native iOS onboarding

- **Date:** 2026-08-31
- **Problem:** The first-run connection screen used custom React Native fields, keyboard avoidance, labels, branding, error text, and loading controls on every platform.
- **Motivation:** Connecting is the first meaningful Mobile workflow and often happens while copying a local network address from Desktop. Native fields and controls provide familiar iOS URL input, secure token entry, keyboard submission, Dynamic Type, semantic errors, and reliable scrolling at accessibility sizes.
- **Product behavior:** iOS now presents a scrollable SwiftUI onboarding surface with a system connection symbol, native URL and secure token fields, a keyboard Go action, an inline semantic error, and a large progress-aware Connect button. URL input disables correction and capitalization, credentials are described as device-local, and every control locks while connection testing is active. Android and Web retain the existing onboarding UI.
- **Implementation:** `OnboardingView.ios.tsx` is a platform-specific fixture-driven View built from Expo UI SwiftUI primitives. A shared props contract keeps fixtures and both platform Views aligned. Server URL normalization, connection testing, query reset, secure persistence, and navigation remain entirely in `OnboardingContainer` and the connection owner modules.
- **Systems affected:** Mobile connection onboarding platform Views, View contract, and onboarding fixtures.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web.
- **Tradeoffs:** The screen keeps manual URL/token entry and does not introduce a second pairing mechanism. The system symbol supports the connection task rather than replacing Cradle's app icon or changing product branding.
- **Follow-up ideas:** Dogfood the keyboard transition and largest Dynamic Type sizes on compact iPhones; consider QR pairing only as a separately designed server-and-Mobile capability.
- **Out of scope:** Authentication protocol changes, QR codes, Bonjour discovery, connection history, Android redesign, and server setup guidance beyond the existing copy.
