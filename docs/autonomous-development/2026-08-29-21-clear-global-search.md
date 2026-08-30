# Clear global search in place

- **Date:** 2026-08-29
- **Problem:** Global Search had keyboard deletion but no direct pointer action to clear a long query.
- **Motivation:** Search supports both keyboard and pointer workflows; recovery should be equally efficient in both.
- **Product behavior:** A localized clear button appears for non-empty queries, preserves input focus, and leaves room for the pending spinner.
- **Implementation:** The fixture-driven View uses its controlled query callback and existing focus helper; no owner state changes.
- **Systems affected:** Global Search View and translations.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** Clearing text preserves the selected search mode.
- **Follow-up ideas:** None.
- **Out of scope:** Search history.
