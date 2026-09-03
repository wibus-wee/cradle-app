# Prepare Work handoffs in a native iOS form

- **Date:** 2026-08-31
- **Problem:** Work Info used a long custom React Native page for status, readiness, three handoff fields, delivery blockers, and pull request actions. On iOS the form did not inherit system field behavior, Dynamic Type, grouped layout, or native progress and status affordances.
- **Motivation:** Preparing a pull request handoff is a focused editing workflow. A native grouped form makes its hierarchy and disabled states easier to scan while giving text entry, accessibility sizing, semantic colors, and action feedback to the platform.
- **Product behavior:** iOS presents Work identity, activity, readiness, handoff metadata, delivery actions, feedback, and the existing pull request as an inset-grouped SwiftUI form. Summary and test plan fields expand vertically, actions show native progress, delivery blockers stay visible beside the disabled submit action, and failed submissions preserve all entered text. Android and Web keep the existing Work Info UI.
- **Implementation:** A platform-specific `WorkDetailView.ios.tsx` renders Expo UI SwiftUI primitives and SF Symbols. The fixture-driven View contract and the handoff initialization, completeness, and delivery-blocker rules moved into shared modules so both platform views keep identical API and product behavior. The Container remains the owner of queries, mutations, and navigation.
- **Systems affected:** Mobile Work detail View, handoff behavior model, View contract, Container type imports, and Work detail fixtures.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web; the diff was checked to confirm the pre-existing handoff validation and delivery-blocker rules remain unchanged.
- **Tradeoffs:** The native draft remains local while the screen is mounted, matching the existing workflow; only an explicit Save Handoff call persists it. Expo UI SwiftUI components require a development or production native build rather than Expo Go.
- **Follow-up ideas:** Dogfood multiline field growth with very long handoffs and consider keyboard-focused Previous/Next controls only if moving among the three fields remains cumbersome.
- **Out of scope:** Server API changes, automatic draft persistence, changing delivery readiness rules, Android form migration, and pull request review UI.
