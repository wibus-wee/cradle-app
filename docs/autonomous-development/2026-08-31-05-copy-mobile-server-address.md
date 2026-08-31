# Copy the Mobile server address

- **Date:** 2026-08-31
- **Problem:** Settings displayed the connected server address but required users to transcribe it when troubleshooting or configuring another device.
- **Motivation:** A reliable copy action removes an error-prone step from common remote-connection support workflows.
- **Product behavior:** The Server row now includes a copy icon and reports whether the address reached the system clipboard without opening the edit screen.
- **Implementation:** `SettingsContainer` owns Expo Clipboard access; `SettingsView` owns only the icon interaction and immediate success or failure feedback.
- **Systems affected:** Mobile Settings and its fixture.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Feedback uses a native alert to remain reliable without introducing an app-wide toast system.
- **Follow-up ideas:** Add a share-sheet action if users frequently send server addresses directly to another device.
- **Out of scope:** Copying authentication tokens and bundling credentials into connection links.
