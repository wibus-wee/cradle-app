# Remember the Usage time range

- **Date:** 2026-08-29
- **Problem:** Usage always reopened at 30 days, discarding a user’s preferred analysis window.
- **Motivation:** People commonly monitor one horizon repeatedly; restoring it removes a recurring setup step.
- **Product behavior:** The last selected 7-day, 30-day, 90-day, or 1-year range is restored on the next visit.
- **Implementation:** A Usage-owned Zustand store uses the shared safe persistence adapter and validates stored range keys before hydration.
- **Systems affected:** Usage dashboard container, range contract, and Usage feature documentation.
- **Validation:** Web typecheck, targeted ESLint, and the extended `CRADLE-USAGE-001` journey, which selects 90 days and verifies the selection after reload. Local browser execution requires the Playwright Chromium matching the upgraded dependency.
- **Tradeoffs:** The preference is local to the device and intentionally does not sync through Fabric.
- **Follow-up ideas:** Persist other high-confidence view preferences only after dogfooding shows repeated setup friction.
- **Out of scope:** Persisting usage data, cross-device settings, and URL query parameters.
