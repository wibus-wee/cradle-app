# Show pull request labels on Mobile

- **Date:** 2026-08-31
- **Problem:** Mobile fetched pull request labels but omitted them from detail, hiding repository-owned triage and release context.
- **Motivation:** Labels often communicate review priority, affected platform, release intent, or workflow state at a glance.
- **Product behavior:** Labeled pull requests now show a compact, wrapping Labels section with each GitHub color represented as a swatch alongside its readable name.
- **Implementation:** The fixture-renderable detail view renders the existing typed label contract with theme-aware text and borders while preserving the authoritative label color as data.
- **Systems affected:** Mobile pull request detail view.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** Colors are shown as small swatches rather than label backgrounds so arbitrary repository colors do not compromise text contrast.
- **Follow-up ideas:** Add label-based inbox filters if triage volume warrants them.
- **Out of scope:** Editing labels, inbox filtering, and server changes.
