import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

/** Stable keys for first-run setup steps. Add new steps here when the dialog grows. */
export const FIRST_RUN_SETUP_STEP_KEYS = ['provider', 'github'] as const

export type FirstRunSetupStepKey = (typeof FIRST_RUN_SETUP_STEP_KEYS)[number]

export type FirstRunSetupCompletedSteps = Partial<Record<FirstRunSetupStepKey, true>>

interface FirstRunSetupState {
  /** Steps the user has finished or explicitly skipped in the setup dialog. */
  completedSteps: FirstRunSetupCompletedSteps
  completeStep: (key: FirstRunSetupStepKey) => void
  completeSteps: (keys: readonly FirstRunSetupStepKey[]) => void
  reset: () => void
}

export function isFirstRunSetupStepCompleted(
  completedSteps: FirstRunSetupCompletedSteps,
  key: FirstRunSetupStepKey,
): boolean {
  return completedSteps[key] === true
}

export function isProviderSetupSatisfied(input: {
  targetsReady: boolean
  providerOptionCount: number
  externalProviderRecordCount: number
}): boolean {
  return input.targetsReady
    && (input.providerOptionCount > 0 || input.externalProviderRecordCount > 0)
}

/**
 * Steps still owed by the user, after subtracting environmentally satisfied
 * capabilities (existing providers / connected GitHub).
 */
export function resolvePendingFirstRunSetupSteps(input: {
  completedSteps: FirstRunSetupCompletedSteps
  providerSatisfied: boolean
  githubSatisfied: boolean
}): FirstRunSetupStepKey[] {
  const pending: FirstRunSetupStepKey[] = []
  if (!isFirstRunSetupStepCompleted(input.completedSteps, 'provider') && !input.providerSatisfied) {
    pending.push('provider')
  }
  if (!isFirstRunSetupStepCompleted(input.completedSteps, 'github') && !input.githubSatisfied) {
    pending.push('github')
  }
  return pending
}

export function areAllFirstRunSetupStepsCompleted(
  completedSteps: FirstRunSetupCompletedSteps,
): boolean {
  return FIRST_RUN_SETUP_STEP_KEYS.every(key => isFirstRunSetupStepCompleted(completedSteps, key))
}

/**
 * First-run setup gate after brand onboarding.
 *
 * Persist key `cradle:first-run-setup:v2` stores per-step completion keys so
 * users only see steps they have not walked yet. Environmentally satisfied
 * steps (existing providers, connected GitHub) are omitted without writing.
 */
export const useFirstRunSetupStore = create<FirstRunSetupState>()(
  persist(
    set => ({
      completedSteps: {},

      completeStep: key => set((state) => {
        if (state.completedSteps[key]) {
          return state
        }
        return {
          completedSteps: { ...state.completedSteps, [key]: true },
        }
      }),

      completeSteps: keys => set((state) => {
        let changed = false
        const next = { ...state.completedSteps }
        for (const key of keys) {
          if (!next[key]) {
            next[key] = true
            changed = true
          }
        }
        return changed ? { completedSteps: next } : state
      }),

      reset: () => set({ completedSteps: {} }),
    }),
    {
      name: 'cradle:first-run-setup:v2',
      storage: persistStorage,
      version: 2,
      partialize: state => ({ completedSteps: state.completedSteps }),
    },
  ),
)
