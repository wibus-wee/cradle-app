# Respect the system Reduce Motion setting

- **Date:** 2026-08-31
- **Problem:** Mobile applied a spring scale animation to every shared pressable interaction even when the operating system's Reduce Motion preference was enabled.
- **Motivation:** Press feedback appears throughout navigation, lists, chat, and composers. Respecting the system preference makes these common interactions more comfortable without removing useful confirmation.
- **Product behavior:** When Reduce Motion is enabled, shared pressables no longer shrink or spring back. They retain a subtle pressed-opacity state and existing haptic feedback. The behavior updates immediately when the system preference changes.
- **Implementation:** A root motion-preference provider owns one `AccessibilityInfo` subscription for the app. `PressableScale` consumes that preference, stops any active spring when reduction is enabled, and holds scale at its stable value. Central ownership avoids one native event listener per rendered pressable.
- **Systems affected:** Mobile root providers, accessibility preference context, and the shared pressable primitive used across Mobile UI.
- **Validation:** Mobile TypeScript, ESLint, and Expo production exports for iOS, Android, and Web.
- **Tradeoffs:** The initial preference is resolved asynchronously after startup; opacity feedback remains intentionally available because it communicates the pressed state without spatial motion.
- **Follow-up ideas:** Apply the same preference to future page, sheet, and content-transition animations before they ship.
- **Out of scope:** Disabling haptics, adding an in-app override, or changing native system navigation animations.
