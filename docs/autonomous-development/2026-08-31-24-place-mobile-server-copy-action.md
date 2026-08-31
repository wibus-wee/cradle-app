# Place server copy with its Mobile setting

- **Date:** 2026-08-31
- **Problem:** The copy-server-address button appeared on the unrelated Usage row, making its effect surprising and leaving the visible Server setting without its own quick action.
- **Motivation:** Compact icon actions need clear spatial ownership, especially when a neighboring row navigates somewhere else.
- **Product behavior:** The copy button now sits beside the Server address and its edit disclosure. Usage returns to a single, predictable navigation row.
- **Implementation:** The fixture-renderable settings view moves the existing action without changing connection or clipboard ownership.
- **Systems affected:** Mobile Settings view.
- **Validation:** Mobile TypeScript and targeted ESLint checks.
- **Tradeoffs:** The row keeps both copy and edit affordances because they are distinct frequent actions.
- **Follow-up ideas:** Add native address sharing next to copy if pairing workflows warrant it.
- **Out of scope:** Connection storage, credentials, and server changes.
