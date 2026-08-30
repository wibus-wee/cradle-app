# Remember the mobile Usage range

- **Date:** 2026-08-31
- **Problem:** Mobile Usage reset to 30 days whenever the screen remounted, forcing users who regularly inspect another horizon to select it again.
- **Motivation:** A dashboard range is a durable viewing preference, and remembering it makes repeated mobile checks faster and less surprising.
- **Product behavior:** The last selected 7-day, 30-day, 90-day, or one-year range is restored before Usage data loads. Missing, invalid, or unreadable storage falls back to 30 days.
- **Implementation summary:** Added a Usage-owned AsyncStorage boundary and a validator based on the existing range catalog. The Container delays its server query until the preference resolves and persists changes without blocking the current selection.
- **Files / systems affected:** Mobile Usage range/storage/container, mobile architecture documentation, and autonomous journal.
- **Validation performed:** Mobile TypeScript checking, ESLint on changed source files, and diff validation.
- **Tradeoffs:** The preference is device-wide rather than scoped per server, and storage write failures are intentionally non-blocking because the active screen still honors the selection.
- **Follow-up ideas:** Generalize preference storage only after another mobile feature needs the same lifecycle and validation behavior.
