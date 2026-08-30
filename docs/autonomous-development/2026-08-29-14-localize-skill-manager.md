# Localize Skill management

- **Date:** 2026-08-29
- **Problem:** Skill Manager and Skill Detail hard-coded their primary controls, search, empty states, and accessibility labels in English.
- **Motivation:** Skills are a core extensibility workflow and should follow the app’s selected language consistently.
- **Product behavior:** The affected Skill surfaces now render supported English, Chinese, Japanese, and Spanish copy, including dynamic skill names in accessible labels.
- **Implementation:** Existing fixture-driven Views read the Skills namespace; data and mutation ownership remain in their containers.
- **Systems affected:** Skill Manager/Detail Views and Skills translations.
- **Validation:** Web typecheck, targeted ESLint, and placeholder parity across supported locales.
- **Tradeoffs:** Scope display names remain owned by the existing presentation map and will be localized separately if needed.
- **Follow-up ideas:** Audit the remaining Skill edit/import surfaces for hard-coded copy.
- **Out of scope:** Skill behavior, storage, and scope semantics.
