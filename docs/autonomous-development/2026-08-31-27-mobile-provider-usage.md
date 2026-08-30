# Attribute Mobile Usage to providers

- **Date:** 2026-08-31
- **Problem:** Mobile showed token totals by model but omitted the provider-target attribution already returned by the Usage API.
- **Motivation:** Users with multiple runtimes or accounts need to know which configured provider is responsible for activity.
- **Product behavior:** Usage now includes a provider section with token totals and proportional bars, using configured names when available and stable target identifiers as fallback.
- **Implementation:** The fixture-renderable Usage view renders the existing typed `byProviderTarget` rows from its summary contract; no additional request or local projection is introduced.
- **Systems affected:** Mobile Usage view.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Provider attribution reports tokens, matching the current Mobile dashboard, rather than estimating cost.
- **Follow-up ideas:** Add cost attribution if Mobile begins loading the server-owned cost summary.
- **Out of scope:** Pricing, provider configuration, and server changes.
