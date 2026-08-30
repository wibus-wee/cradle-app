# Show session note save status

- **Date:** 2026-08-29
- **Problem:** Session notes autosaved silently, leaving users unsure whether an edit had reached the server before changing context.
- **Motivation:** Autosave is trustworthy only when its state is visible, especially for notes meant to carry work context forward.
- **Product behavior:** The Notes header now announces localized Not saved yet, Saving, Saved, or Save failed states as the existing autosave progresses.
- **Implementation:** A new props-only notes View renders the controlled editor and live status; the query-owning environment panel derives status from draft equality and mutation state.
- **Systems affected:** Session Environment, a targeted View test, and Chrome translations.
- **Validation:** Targeted Vitest coverage, web typecheck, targeted ESLint, locale JSON parsing, and pre-commit validation.
- **Tradeoffs:** The status reflects the current client mutation and server snapshot; it is not a multi-client presence indicator.
- **Follow-up ideas:** Add explicit retry if repeated network failures are common in dogfooding.
- **Out of scope:** Note history, collaboration, and manual-save mode.
