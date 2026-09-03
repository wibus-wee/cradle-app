# Give Mobile chat controls 44-point targets

- **Date:** 2026-08-31
- **Problem:** Several high-frequency Chat controls used 32–40 point pressable areas. Send, stop, composer options, jump-to-latest, Queue/Steer, suggestions, and activity details were harder to hit than iOS guidance recommends, especially one-handed or while moving.
- **Motivation:** Chat is Mobile's primary operating surface. Reliable touch targets improve speed and accessibility without requiring the transcript itself to be rewritten in native UI.
- **Product behavior:** Interactive Chat controls now provide at least a 44-point target. The composer grows slightly to accommodate system-sized options and send buttons; runtime stop and jump controls use the same target size; continuation choices, command or skill suggestions, and activity summaries have full-height rows. Icon glyphs remain compact so the interface gains usability without looking visually inflated.
- **Implementation:** Existing React Native pressable dimensions were aligned to a 44-point baseline, with matching corner radii and composer minimum height. The jump control offset moved with its larger frame. The attachment remove control remains visually 32 points because its existing six-point hit slop on every side already produces a 44-point target.
- **Systems affected:** Mobile Chat Composer, transcript controls, activity affordance, and autonomous development journal.
- **Validation:** Mobile ESLint and TypeScript passed, and Expo production exports completed for iOS, Android, and Web.
- **Tradeoffs:** The composer and active-run strip consume a few additional vertical points. Preserving compact icon sizes keeps hierarchy calm, but the larger invisible/visible control frames may slightly reduce text width on very narrow devices.
- **Follow-up ideas:** Audit Dynamic Type at accessibility sizes and verify hardware-keyboard composer behavior on iPad.
- **Out of scope:** Rebuilding the transcript or composer in SwiftUI, changing gesture behavior, attachment redesign, typography changes, and non-Chat controls.
