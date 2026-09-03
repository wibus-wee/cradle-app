# Confirm model mapping deletion

- **Date:** 2026-08-29
- **Problem:** The Model Registry trash action immediately deleted a mapping with no chance to catch a misclick.
- **Motivation:** A mapping changes how agents resolve a model; destructive settings need an explicit, informed boundary.
- **Product behavior:** Delete opens a localized confirmation naming the model and explaining the automatic-matching fallback. Only confirmation starts deletion.
- **Implementation:** The settings surface holds the pending mapping and reuses the shared destructive Alert Dialog around the existing mutation.
- **Systems affected:** Model Registry settings and translations.
- **Validation:** Web typecheck, targeted ESLint, locale JSON parsing, and pre-commit validation.
- **Tradeoffs:** Confirmation adds one click to an intentionally infrequent destructive action.
- **Follow-up ideas:** Consider an undo toast if mappings gain a recoverable server-side history.
- **Out of scope:** Soft deletion and audit history.
