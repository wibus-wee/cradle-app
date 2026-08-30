# Open changed pull request files from mobile

- **Date:** 2026-08-31
- **Problem:** Changed-file rows showed paths and line counts but were inert even though the detail response included canonical blob URLs.
- **Motivation:** Reviewers often need to inspect one suspicious file. Opening that file directly avoids navigating through the entire provider pull-request page.
- **Product behavior:** Every changed-file row now shows an external-link indicator and opens its exact GitHub blob through the device handler. Failures produce a focused alert.
- **Implementation:** Added a file-open callback to the fixture-driven View and routed server-owned blob URLs through the Container’s shared native-link helper.
- **Systems affected:** Mobile pull-request detail View, Container, fixtures, and product documentation.
- **Validation:** Mobile TypeScript typecheck, scoped ESLint, and diff validation.
- **Tradeoffs:** The provider renders the file and diff; Cradle does not yet provide inline patch review on mobile.
- **Follow-up ideas:** Add an in-app patch viewer when the mobile design has a scalable strategy for long lines and inline review threads.
