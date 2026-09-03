# Clear Skill search in place

- **Date:** 2026-08-29
- **Problem:** Clearing a Skill query required selecting and deleting the text manually.
- **Motivation:** Skill inventories can be large, so repeated search refinement should remain quick.
- **Product behavior:** A localized clear control appears inside non-empty Skill search and restores the full filtered scope with one click.
- **Implementation:** The fixture-driven View uses its existing controlled search callback and design-system button primitive.
- **Systems affected:** Skill Manager View and translations.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** The scope filter remains active because clearing text should not discard a separate user choice.
- **Follow-up ideas:** None.
- **Out of scope:** Search history and fuzzy ranking.
