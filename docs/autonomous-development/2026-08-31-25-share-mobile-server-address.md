# Share the Mobile server address

- **Date:** 2026-08-31
- **Problem:** Moving a Cradle server address to another device required copying it, switching apps, and pasting it manually.
- **Motivation:** Native sharing makes controller setup and self-handoff faster while letting the user choose the destination.
- **Product behavior:** The Server setting now offers a familiar share action that opens the platform share sheet with the configured URL.
- **Implementation:** The fixture-renderable view exposes a share callback while the container owns React Native's platform share API. Only the URL is provided to the share sheet.
- **Systems affected:** Mobile Settings container, view, and fixture contract.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** The action shares plain text for broad destination compatibility rather than a custom pairing payload.
- **Follow-up ideas:** Add a scoped pairing artifact only if the server gains a short-lived invitation contract.
- **Out of scope:** Authentication tokens, QR codes, and server changes.
