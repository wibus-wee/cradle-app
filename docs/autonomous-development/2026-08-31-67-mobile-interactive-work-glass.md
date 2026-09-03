# Make the Work composer interactive Liquid Glass

- **Date:** 2026-08-31
- **Problem:** The Work composer still rendered its iOS 26 glass as a non-interactive background, unlike the Chat composer and native system controls.
- **Motivation:** Creating Work is a primary floating control surface and should respond consistently to touch across collapsed and expanded states.
- **Product behavior:** The Work composer now uses interactive Liquid Glass for both its compact launcher and expanded form while preserving the existing resize gesture and animation.
- **Implementation summary:** Moved the existing animated composer stages inside the official GlassView content container and enabled its iOS 26 interactive behavior.
- **Files / systems affected:** Mobile Work composer.
- **Validation performed:** Mobile ESLint and TypeScript typecheck.
- **Tradeoffs:** The existing layout and animation remain unchanged; this improvement delegates glass feedback to iOS rather than adding custom motion.
- **Follow-up ideas:** Dogfood the glass response on device alongside Reduce Motion and larger Dynamic Type settings.
- **Out of scope:** Work creation semantics, server changes, and non-Mobile UI.
