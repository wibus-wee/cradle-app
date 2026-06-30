# Onboarding

`features/onboarding` owns the first-run overlay, its brand-film animation, and the persisted completion state. The surface is intentionally small: it introduces Cradle with icon, name, slogan, language selection, and a single entry action.

## Files

- **onboarding-page.tsx**: Overlay shell with localized brand copy, language switching, skip control, and the cinematic icon/name/slogan stage.
- **onboarding-store.ts**: Zustand-backed onboarding visibility and step state persisted by the onboarding feature.

## Ownership

Onboarding copy is owned by the `onboarding` i18n namespace. Animation CSS uses `onboarding-*` class names in the app stylesheet so the visual lifecycle remains owned by this feature.
