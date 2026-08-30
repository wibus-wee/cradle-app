# Estimate active download completion

- **Date:** 2026-08-31
- **Problem:** Download Center showed bytes, percent, and lifetime average throughput but still required users to calculate whether an active download would finish soon.
- **Motivation:** A compact ETA makes large runtime, model, and desktop-update transfers easier to plan around.
- **Product behavior:** Active downloads with a known total and valid transfer interval now show a localized approximate duration remaining beside average throughput. The estimate disappears when the transport cannot support it.
- **Implementation summary:** Added a pure linear extrapolation from remaining bytes and the existing lifetime average rate, reused the shared compact duration formatter, and updated the active fixture to carry a coherent progress timestamp.
- **Files / systems affected:** Web Download Center presentation/View/fixture/tests, chrome locales, feature documentation, and autonomous journal.
- **Validation performed:** Focused Download Center tests, web TypeScript checking, ESLint on changed source files, locale JSON parsing, and diff validation.
- **Tradeoffs:** The ETA is intentionally approximate and can move as throughput changes. It does not add smoothing or confidence heuristics; missing totals, invalid timestamps, zero progress, and completed transfers omit it.
- **Follow-up ideas:** Prefer a transport-reported instantaneous or smoothed rate if the shared download contract gains one.
