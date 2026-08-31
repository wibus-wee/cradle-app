# Break down Mobile token usage

- **Date:** 2026-08-31
- **Problem:** Mobile Usage showed only combined token totals even though the API already distinguishes prompt and completion tokens.
- **Motivation:** Input and output volume describe different usage patterns and help users understand why a selected range is large.
- **Product behavior:** The selected range now displays input-token and output-token totals directly beneath the combined total.
- **Implementation:** `UsageView` renders the existing authoritative summary fields in a compact two-column breakdown.
- **Systems affected:** Mobile Usage view only.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** The breakdown reports volume, not monetary cost, because pricing depends on provider and model contracts.
- **Follow-up ideas:** Add cost only after an authoritative server-side cost model exists.
- **Out of scope:** Pricing estimates, model-specific rates, and API changes.
