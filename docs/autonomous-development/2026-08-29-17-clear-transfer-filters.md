# Recover from empty transfer filters

- **Date:** 2026-08-29
- **Problem:** Download Activity could be filtered to an empty list without a direct recovery action.
- **Motivation:** Transfer troubleshooting should not stall on an over-constrained view.
- **Product behavior:** When transfers exist but none match, the empty state clears both channel and status filters in one action.
- **Implementation:** The props-only Activity View resets its two pieces of local filter state.
- **Systems affected:** Managed Resource Activity View and translations.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** The action appears only for filtered emptiness, not a genuinely empty history.
- **Follow-up ideas:** None.
- **Out of scope:** Deleting transfer history.
