# Add projects from empty New Work

- **Date:** 2026-08-29
- **Problem:** New Work explained that no local workspace was available, but its only recovery action was hidden inside the workspace selector menu.
- **Motivation:** A blocking empty state should lead directly to the action that resolves it, especially for first-time Work users.
- **Product behavior:** The no-workspace notice now includes Add project, opens the existing native folder picker, and disables with Adding… feedback while the picker action is active.
- **Implementation:** The query/action-owning page passes its existing `useAddWorkspace` state and callback into the props-only page View.
- **Systems affected:** New Work container, View, Storybook scenarios, and a targeted interaction test.
- **Validation:** Targeted Vitest coverage, web typecheck, targeted ESLint, and pre-commit validation.
- **Tradeoffs:** The action intentionally duplicates the selector-menu entry only in the blocking zero-workspace state.
- **Follow-up ideas:** Explain unsupported multi-folder workspaces at picker time if that becomes a common onboarding failure.
- **Out of scope:** Workspace creation redesign and multi-folder Work support.
