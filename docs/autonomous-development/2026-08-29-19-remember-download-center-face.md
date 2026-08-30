# Remember the Download Center face

- **Date:** 2026-08-29
- **Problem:** Download Center always reopened on Library even for users repeatedly monitoring Activity.
- **Motivation:** The two faces support distinct tasks, and restoring the last one removes repetitive navigation.
- **Product behavior:** The last selected Library or Activity face is restored on the next visit on this device.
- **Implementation:** The dependency-owning container safely reads/writes one local preference; the fixture-driven View reports explicit face changes.
- **Systems affected:** Managed Resources container/View and feature documentation.
- **Validation:** Web typecheck, targeted ESLint, and existing Managed Resources tests.
- **Tradeoffs:** The preference is local and does not sync through Fabric.
- **Follow-up ideas:** None.
- **Out of scope:** Persisting Activity filters.
