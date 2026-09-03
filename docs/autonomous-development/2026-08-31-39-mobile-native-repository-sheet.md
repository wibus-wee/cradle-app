# Choose repositories in a native iOS sheet

- **Date:** 2026-08-31
- **Problem:** Work Composer presented its repository picker with a hand-built modal, backdrop, drag gesture, fixed off-screen offset, and custom spring animation on every platform.
- **Motivation:** Repository selection is a modal, scrollable task that maps directly to the iOS sheet pattern. Letting the system own presentation improves gesture physics, dismissal, safe areas, keyboard coordination, accessibility, and iPad behavior while removing fragile custom interaction code from iOS.
- **Product behavior:** iOS opens Repository in a system bottom sheet at a 78-percent detent with the native drag indicator, backdrop, interactive swipe dismissal, and automatic keyboard handling. Search, selected state, repository metadata, close, and selection behavior remain unchanged. The shared close and search controls now meet the 44-point touch target. Android and Web retain the existing custom modal presentation.
- **Implementation:** The repository list and search UI moved into one shared feature View. Platform-resolved sheet shells own presentation only: iOS uses Expo UI's SwiftUI-backed `BottomSheet`, while the base shell retains the existing React Native Modal and animation. A shared props contract preserves the Work Composer lifecycle, including focus restoration after dismissal.
- **Systems affected:** Mobile Work Composer repository picker shell, shared picker content, and picker props contract.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web.
- **Tradeoffs:** The iOS sheet uses one fixed 78-percent detent instead of content-sized presentation so long repository lists have a predictable scroll area. Expo UI's native bottom sheet remains beta and requires a development or production native build.
- **Follow-up ideas:** Dogfood the detent on compact and large iPhones and add a second medium detent only if switching between overview and search genuinely benefits from it.
- **Out of scope:** Repository creation, sorting, pinning, multi-selection, Android sheet migration, and Work Composer layout changes.
