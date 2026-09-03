# Join Fabric from Mobile onboarding

- **Date:** 2026-08-31
- **Problem:** Mobile onboarding previously assumed every device connected to one Cradle Server by URL and optional bearer token. That model could not enroll a Controller identity, wait for approval, recover a Fabric membership, or select an authorized computer.
- **Motivation:** Mobile is a Fabric Controller. It should discover granted Nodes through the Fabric directory and send existing Cradle requests through the encrypted relay transport without storing a Server credential.
- **Product behavior:** The first-run screen accepts a Fabric pairing code, displays the Controller fingerprint while approval is pending, handles rejected, expired, revoked, invalid, and offline states, and lets the user choose an authorized computer. Direct Server remains available as an explicit development fallback with URL and optional token fields.
- **Implementation:** `OnboardingContainer` owns the Fabric and direct-mode workflows. The fixture-driven `OnboardingView` renders Fabric enrollment and Node selection on every platform; `DirectServerOnboardingView` renders the fallback form. `FabricProvider` owns identity restoration, membership refresh, secure key storage, and the selected Node. The connection owner exposes either a Fabric Node transport or a direct transport to the rest of Mobile.
- **Systems affected:** Mobile connection onboarding, Fabric identity and directory state, secure storage, transport selection, and onboarding fixtures.
- **Validation:** Mobile TypeScript and ESLint pass. The native Fabric Mobile E2E covers enrollment approval, Node discovery, encrypted API traffic, app relaunch, and revocation recovery on an iOS simulator.
- **Tradeoffs:** Fabric onboarding currently uses the shared React Native View on iOS so the security and recovery states have one complete implementation. SwiftUI-native controls remain in the direct connection editor and settings surfaces.
- **Follow-up ideas:** Add a SwiftUI Fabric View only when it preserves the full enrollment and recovery contract; dogfood large Dynamic Type and background recovery on physical devices.
- **Out of scope:** Bonjour discovery and automatic approval that bypasses the Fabric owner.
