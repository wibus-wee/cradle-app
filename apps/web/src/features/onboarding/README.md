# Onboarding

`features/onboarding` owns the first-run brand overlay and the multi-step setup
dialog that follows it.

## Flow

1. **Brand overlay** (`onboarding-page.tsx`) — icon / name / slogan; Enter or
   click completes brand onboarding.
2. **Setup dialog** (`credential-setup-dialog.tsx`) — opens for any pending
   step keys (`provider`, `github`). Environmentally satisfied steps are
   omitted; only missing keys are shown.

## Step keys

Persist store `cradle:first-run-setup:v2` records `completedSteps`:

```ts
{ provider?: true, github?: true }
```

- Completing or skipping a step writes that key.
- Dismissing the dialog writes every remaining key in the current session queue.
- Existing providers / connected GitHub satisfy a step without writing a key.
- Adding a future step means appending to `FIRST_RUN_SETUP_STEP_KEYS` and the
  resolver — users missing the new key will see only that step.

## Files

- **onboarding-page.tsx**: Brand film overlay.
- **onboarding-store.ts**: Brand onboarding completion state.
- **credential-setup-dialog.tsx**: Multi-step first-run setup dialog.
- **credential-setup-store.ts**: Per-step setup gate.

## Ownership

Copy lives in the `onboarding` i18n namespace. GitHub connection semantics stay
owned by settings/`github-auth`; onboarding only hosts the shared view.
