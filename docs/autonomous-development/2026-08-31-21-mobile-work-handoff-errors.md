# Surface mobile Work handoff failures

- **Date:** 2026-08-31
- **Problem:** Saving handoff metadata or submitting Work from mobile could fail silently, leaving users unsure whether the server accepted the action.
- **Motivation:** Handoff and pull-request submission are consequential operations that need explicit failure feedback, especially on unreliable mobile connections.
- **Product behavior:** Failed Save handoff and Submit Work requests now show distinct native alerts with the server-provided error. Locally edited handoff fields remain available.
- **Implementation summary:** Added typed TanStack mutation error handlers in `WorkDetailContainer`; the existing View and successful cache replacement behavior remain unchanged.
- **Files / systems affected:** Mobile Work detail Container, mobile documentation, and autonomous journal.
- **Validation performed:** Mobile TypeScript checking, ESLint on the changed source file, and diff validation.
- **Tradeoffs:** Errors are reported after the request fails but are not queued for automatic retry. The user remains in control of retry timing.
- **Follow-up ideas:** Add mutation success feedback only if cache-updated screen state proves insufficiently clear in dogfooding.
