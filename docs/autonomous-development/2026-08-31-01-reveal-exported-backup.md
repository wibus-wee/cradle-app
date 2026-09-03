# Reveal exported backups

- **Date:** 2026-08-31
- **Problem:** A completed backup exposed its archive path only as status text, making users navigate to the file manually before transferring or inspecting it.
- **Motivation:** Exporting is usually followed immediately by locating the archive; that handoff should be direct and reliable.
- **Product behavior:** Successful export status includes a localized **Show in folder** action that opens the desktop file manager with the archive selected. Pending, failed, restore, and web-only states do not show the action.
- **Implementation:** The fixture-driven backup View receives an optional exported archive path and callback. Its Electron container derives that state from the desktop-owned backup status and uses the existing validated `showItemInFolder` IPC method.
- **Systems affected:** Backup & Restore settings, settings translations, View story, and targeted View coverage.
- **Validation:** Targeted Vitest coverage, web typecheck, targeted ESLint, and locale JSON parsing.
- **Tradeoffs:** The action reports a native reveal failure through the existing backup status alert; it does not proactively check whether users moved or deleted an old archive.
- **Follow-up ideas:** Consider a compact backup history only if dogfooding shows repeated exports are difficult to manage.
- **Out of scope:** Backup creation, retention, restore semantics, archive history, and filesystem ownership.
