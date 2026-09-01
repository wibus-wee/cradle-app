# Open a Work conversation from its iOS toolbar

- **Date:** 2026-08-31
- **Problem:** Creating a Work opens its info page, but that page had no route to the primary conversation. Users had to return to the Work list and reopen the same item.
- **Motivation:** Work metadata and the agent conversation are two views of one workflow, so moving from delivery context back to active collaboration should be one tap.
- **Product behavior:** Work Info now has a native iOS **Conversation** toolbar action that opens the Work's primary thread. The control has an explicit VoiceOver label and hint.
- **Implementation summary:** The Work Container reads the existing `primaryThread.id` from its owned detail response and performs navigation from an iOS-only Expo Router toolbar button. No View projection or additional request was added.
- **Files / systems affected:** Mobile Work detail navigation on iOS.
- **Validation performed:** Targeted Mobile ESLint, Mobile TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** The action uses the current navigation stack, so Back returns to Work Info and preserves the user's delivery context.
- **Follow-up ideas:** Add the inverse Work Info action to the conversation toolbar when a stable Work identifier is available in the chat detail response.
- **Out of scope:** Android/web navigation, changing the Work creation destination, and Work-to-session data model changes.
