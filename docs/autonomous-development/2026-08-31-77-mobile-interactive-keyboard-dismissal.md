# Dismiss the Chat keyboard interactively on iOS

- **Date:** 2026-08-31
- **Problem:** Dragging the conversation transcript left the keyboard fixed in place, unlike the standard iOS messaging interaction.
- **Motivation:** Interactive keyboard dismissal makes it easier to reclaim reading space without abandoning a draft or reaching for a separate control.
- **Product behavior:** On iOS, dragging the Chat transcript now moves the keyboard in sync with the gesture. Reversing the drag cancels dismissal. Tapping the transcript to close the keyboard continues to work.
- **Implementation summary:** Enabled React Native's iOS-native `interactive` keyboard dismissal mode on the existing inverted transcript list while retaining the composer offset and tap handling. Other platforms keep the prior behavior.
- **Files / systems affected:** Mobile Chat transcript interaction on iOS.
- **Validation performed:** Targeted Mobile ESLint, TypeScript typecheck, and diff whitespace validation.
- **Tradeoffs:** The gesture is delegated to UIKit and therefore follows system motion and keyboard behavior rather than a Cradle-specific animation.
- **Follow-up ideas:** Evaluate the same native gesture on other long-form Mobile composer surfaces if they adopt scrollable transcripts.
- **Out of scope:** Composer layout changes, keyboard accessory views, Android/web behavior, and custom gesture recognition.
