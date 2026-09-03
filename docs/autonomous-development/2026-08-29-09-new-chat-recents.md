# Resume recent chats from New Chat

- **Date:** 2026-08-29
- **Problem:** A completed recent-session View existed only in Storybook; production New Chat never exposed it.
- **Motivation:** Starting a new prompt and resuming nearby work are adjacent intents, and the system already has the required session data.
- **Product behavior:** With a project selected and an empty composer, New Chat shows the three most recently updated chats with live relative times; selecting one resumes it using the current surface policy.
- **Implementation:** The existing workspace session query is projected in the owner, while the shell gains a render slot for the existing fixture-driven recent-session View.
- **Systems affected:** New Chat owner, shell View, existing recent-session View, and feature documentation.
- **Validation:** Web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** The list is intentionally limited to three and hidden while composing so it does not compete with the active task.
- **Follow-up ideas:** Add a full recent-chat search only if the global palette proves insufficient.
- **Out of scope:** A new endpoint, cross-workspace recents, and session preview content.
