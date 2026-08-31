# Attribute Usage to agents on iOS

- **Date:** 2026-08-31
- **Problem:** The Usage API returned token totals by agent, but Mobile only visualized model and provider attribution, leaving an important ownership dimension invisible.
- **Motivation:** Users operating several specialized agents need to see which agent workflows account for Usage, not only which underlying model served them.
- **Product behavior:** The native iOS Usage dashboard now shows an **Agents** section when agent attribution is available. Each agent has an exact token total and a relative progress bar. The section shows five agents initially and offers native **Show All** / **Show Top 5** controls for larger configurations.
- **Implementation summary:** Rendered the existing `summary.byAgent` contract directly in the SwiftUI Usage View using the established model/provider presentation pattern. Updated the fixture to keep the rendering seam representative.
- **Files / systems affected:** Mobile native Usage dashboard and its fixture.
- **Validation performed:** Targeted Mobile ESLint, Mobile TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** Relative bars communicate distribution within the selected range but are not percentages; exact token values remain visible to avoid ambiguity.
- **Follow-up ideas:** Add agent attribution to shared Usage snapshots if users want that dimension in external reports.
- **Out of scope:** Agent-level drill-down, sorting changes, percentages, cost allocation, and non-iOS presentation.
