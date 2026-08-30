# Copy route failure diagnostics

- **Date:** 2026-08-29
- **Problem:** Route errors displayed useful diagnostics but forced users to manually select them before reporting a failure.
- **Motivation:** A copy-ready handoff makes support and issue filing materially faster when a pane fails.
- **Product behavior:** Route error surfaces offer “Copy error” and confirm “Copied” after writing the message and available development stack to the clipboard.
- **Implementation:** The fixture-driven View owns only acknowledgement state; the router adapter owns clipboard access and diagnostic composition.
- **Systems affected:** Shared route fallback, common fixture gallery, translations, and component documentation.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** Production copies omit stacks that are intentionally hidden from the surface.
- **Follow-up ideas:** Add structured diagnostic context if a stable incident identifier becomes available.
- **Out of scope:** Automatic issue creation and telemetry upload.
