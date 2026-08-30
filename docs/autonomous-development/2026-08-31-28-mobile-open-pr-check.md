# Open pull request checks from mobile

- **Date:** 2026-08-31
- **Problem:** Pull-request detail showed check status but provided no way to inspect a failure, pending run, or provider report.
- **Motivation:** A visible check becomes actionable when one tap reaches its exact logs or status page, shortening mobile review triage.
- **Product behavior:** Checks with a provider URL show an external-link indicator and open that destination through the device handler. Checks without a URL remain non-interactive. Link failures produce a focused alert.
- **Implementation:** Added a typed check-open callback to the fixture-driven View and reused a Container-owned native-link helper for both pull-request and check URLs.
- **Systems affected:** Mobile pull-request detail View, Container, fixtures, and product documentation.
- **Validation:** Mobile TypeScript typecheck, scoped ESLint, and diff validation.
- **Tradeoffs:** Check content remains on GitHub rather than being duplicated in Cradle, and availability depends on the provider URL returned by the server.
- **Follow-up ideas:** Add check reruns only after the server owns permission checks and provider mutation semantics.
