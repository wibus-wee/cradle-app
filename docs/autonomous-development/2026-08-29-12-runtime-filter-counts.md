# Show Runtime filter counts

- **Date:** 2026-08-29
- **Problem:** Installed and Updates filters gave no indication whether they contained anything before selection.
- **Motivation:** Update availability and installed inventory are high-value states that should be visible at a glance.
- **Product behavior:** The Runtime filter tabs show installed local/remote/Registry counts and the number of Registry updates.
- **Implementation:** Counts are derived from the existing typed list inputs and displayed with tabular numerals.
- **Systems affected:** Runtime list View.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** Built-in runtimes are intentionally excluded because the two counts describe managed ACP inventory.
- **Follow-up ideas:** None.
- **Out of scope:** Background update checks and notifications.
