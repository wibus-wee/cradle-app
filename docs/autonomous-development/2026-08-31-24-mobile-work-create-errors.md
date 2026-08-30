# Surface mobile Work creation failures

- **Date:** 2026-08-31
- **Problem:** Creating Work from any mobile entry point could fail silently, leaving users unsure whether the request was still pending or had been rejected.
- **Motivation:** The shared Work composer appears on three primary surfaces, so one missing mutation error affected a large part of the mobile creation workflow.
- **Product behavior:** Failed Work creation now shows a native alert with the server error. The composer keeps the objective and selected workspace ready for retry.
- **Implementation summary:** Added a typed error handler to the shared `useCreateWork` mutation owner; all three consumers inherit the behavior without View changes.
- **Files / systems affected:** Mobile Work creation hook, mobile documentation, and autonomous journal.
- **Validation performed:** Mobile TypeScript checking, ESLint on the changed source file, and diff validation.
- **Tradeoffs:** Failures are not retried automatically because creation is a user-initiated operation with possible validation or repository-state errors.
- **Follow-up ideas:** Add field-level validation only when the create API exposes stable structured failure categories.
