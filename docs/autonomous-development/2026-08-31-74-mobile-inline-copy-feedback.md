# Confirm server address copies without interrupting Settings

- **Date:** 2026-08-31
- **Problem:** Copying the server address opened a modal success alert, forcing an extra dismissal for a routine reversible action.
- **Motivation:** Lightweight actions should acknowledge success in context and reserve alerts for failures or decisions that need attention.
- **Product behavior:** The iOS Settings copy row now changes to a green checkmark and “Server Address Copied” for 1.5 seconds. The SF Symbol bounces once, a light selection haptic plays, and VoiceOver announces the result. Copy failures still show an alert.
- **Implementation summary:** Added local feedback state with cleanup-safe timing, Expo UI observable state for the native symbol-effect trigger, Expo Haptics, and an explicit dynamic accessibility label inside the existing fixture-driven Settings View.
- **Files / systems affected:** Mobile iOS Settings presentation only.
- **Validation performed:** Targeted Mobile ESLint, TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** The feedback is intentionally transient and is not stored. Haptics respect the device's system settings and may not play in all environments.
- **Follow-up ideas:** Apply the same nonblocking success language to other simple copy actions while keeping destructive and failure alerts prominent.
- **Out of scope:** Sharing behavior, connection mutations, Android UI, and desktop/web settings.
