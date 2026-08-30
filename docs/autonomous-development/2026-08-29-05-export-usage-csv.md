# Export the visible Usage range

- **Date:** 2026-08-29
- **Problem:** Usage insights were visible only inside Cradle and could not be carried into a spreadsheet or cost review.
- **Motivation:** A lightweight export turns existing telemetry into something users can analyze and share without adding reporting infrastructure.
- **Product behavior:** Populated Usage dashboards can download the selected range as CSV with daily prompt, completion, total tokens, turns, and USD cost.
- **Implementation:** A pure projection filters local-calendar dates and aggregates per-model cost by day; the container owns the browser download side effect while the View receives an export callback.
- **Systems affected:** Usage dashboard, fixtures, translations, and feature documentation.
- **Validation:** Targeted Vitest coverage for range filtering/cost aggregation, web typecheck, ESLint, and the extended `CRADLE-USAGE-001` journey, which inspects the downloaded CSV against the real Agent aggregate. Local browser execution requires the Playwright Chromium matching the upgraded dependency.
- **Tradeoffs:** CSV is daily rather than per-run and reflects the same loaded fleet-wide data shown in the dashboard.
- **Follow-up ideas:** Add per-model export only if users need more granular reconciliation.
- **Out of scope:** Server-generated reports, cloud sharing, and XLSX formatting.
