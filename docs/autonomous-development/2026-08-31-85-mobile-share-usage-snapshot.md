# Share a Usage snapshot from iOS

- **Date:** 2026-08-31
- **Problem:** Mobile's Usage dashboard exposed useful totals and attribution but offered no way to move that information into a status update, note, or conversation.
- **Motivation:** A compact system-share workflow turns already-owned Usage data into something users can communicate without manually transcribing metrics or taking screenshots.
- **Product behavior:** The iOS Usage navigation bar now includes **Share**. It opens the system share sheet with a plain-text snapshot for the selected range: total/input/output tokens, turns, today, daily average, current streak, and up to five model and provider totals. The control is disabled while a share is being prepared and reports failures in place.
- **Implementation summary:** Added a pure report formatter over the existing Usage response contracts and an iOS-only native toolbar action in the Container. The fixture-driven Usage View remains independent of navigation and system sharing.
- **Files / systems affected:** Mobile Usage formatting and iOS Container toolbar.
- **Validation performed:** Targeted Mobile ESLint, Mobile TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** Plain text is broadly interoperable and accessible but does not preserve the dashboard chart. Breakdown lists are capped at five entries to keep share previews concise.
- **Follow-up ideas:** Add a CSV or image export only if users need deeper external reporting.
- **Out of scope:** Cost estimation, chart images, CSV, server-side exports, and non-iOS toolbar behavior.
