# Make global shortcuts cross-platform

- **Date:** 2026-08-31
- **Problem:** Several global actions registered `meta: true` directly, so their documented Command shortcuts had no Control equivalent on Windows or Linux despite the shortcut engine already supporting a platform modifier.
- **Motivation:** Surface navigation and layout controls should remain equally operable on every supported desktop platform.
- **Product behavior:** Settings, New Chat, surface close, sidebar controls, Jarvis, and layout focus now use Command on macOS and Control on Windows/Linux. The shortcut reference lists both variants, and command-palette key labels reflect the current platform.
- **Implementation:** Global Command-style registrations use the existing `mod` shortcut definition. Intentionally Control-specific navigation chords and the macOS Settings escape chord remain unchanged. Modifier matching tests cover both macOS and Windows platform resolution.
- **Systems affected:** App chrome shortcut registration, shortcut reference, command palette keycaps, shortcut matching tests, and ownership documentation.
- **Validation:** Targeted Vitest coverage, web typecheck, targeted ESLint, and diff whitespace checks.
- **Tradeoffs:** Browsers may reserve some Control chords before page code receives them; the primary guarantee is the desktop shell, where Cradle owns the window shortcut lifecycle.
- **Follow-up ideas:** Audit native-only and plugin-contributed keycap labels for the same platform-aware display contract.
- **Out of scope:** User-remappable defaults, Control-specific chords, native global hotkeys, and browser-reserved shortcut overrides.
