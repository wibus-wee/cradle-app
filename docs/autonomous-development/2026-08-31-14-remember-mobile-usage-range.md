# Remember the Mobile Usage range

- **Date:** 2026-08-31
- **Problem:** Mobile Usage reset to 30 days whenever users left and reopened the screen.
- **Motivation:** Usage analysis is repetitive, and restoring the user's preferred horizon removes an unnecessary interaction on every visit.
- **Product behavior:** The last selected 7-day, 30-day, 90-day, or 1-year range now restores on the device before Usage data is requested.
- **Implementation:** A Usage-owned AsyncStorage module validates persisted values, and `UsageContainer` waits for restoration to avoid querying the default range before the saved range.
- **Systems affected:** Mobile Usage container and local preference storage.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** The preference is device-local and intentionally falls back to 30 days if storage is unavailable or invalid.
- **Follow-up ideas:** Move this preference server-side only if users expect the same range across devices.
- **Out of scope:** Cross-device preference sync and changes to Usage APIs.
