# Expand Mobile model usage

- **Date:** 2026-08-31
- **Problem:** Mobile reported the total model count but silently displayed only the top five models.
- **Motivation:** Less-used models can explain unexpected token volume and should remain inspectable without making the default screen excessively long.
- **Product behavior:** Usage now offers an explicit command to show every model and to collapse back to the top five.
- **Implementation:** The fixture-renderable `UsageView` owns a local expansion state and renders the authoritative model summary without changing its ordering.
- **Systems affected:** Mobile Usage view only.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** The default remains compact; expanding a very large model set renders all returned rows in the existing scroll surface.
- **Follow-up ideas:** Virtualize only if real model counts make the expanded view slow.
- **Out of scope:** Server pagination, custom sorting, and model filtering.
