# Show session note save status

- **Date:** 2026-08-29
- **Problem:** Session notes autosaved silently, leaving users unsure whether an edit had reached the server before changing context.
- **Motivation:** Autosave is trustworthy only when its state is visible, especially for notes meant to carry work context forward.
- **Product behavior:** A session-only Environment tab exposes the Notes editor and announces localized Not saved yet, Saving, Saved, or Save failed states as autosave progresses.
- **Implementation:** A props-only notes View renders the controlled editor and live status; the query-owning environment panel derives status from draft equality and mutation state, and the right aside mounts that panel only when a session is selected.
- **Systems affected:** Session Environment, a targeted View test, and Chrome translations.
- **Validation:** Targeted Vitest coverage, web typecheck, targeted ESLint, locale JSON parsing, E2E matrix contract, Cucumber step dry-run, and `CRADLE-ENV-001` browser journey definition.
- **Tradeoffs:** The status reflects the current client mutation and server snapshot; it is not a multi-client presence indicator.
- **Follow-up ideas:** Add explicit retry if repeated network failures are common in dogfooding.
- **Out of scope:** Note history, collaboration, and manual-save mode.
