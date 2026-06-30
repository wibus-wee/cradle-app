import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

export const ONBOARDING_TOTAL_STEPS = 5

interface OnboardingState {
  completed: boolean
  step: number
  nextStep: () => void
  prevStep: () => void
  goToStep: (step: number) => void
  complete: () => void
  reset: () => void
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    set => ({
      completed: false,
      step: 0,

      nextStep: () =>
        set(s => ({
          step: Math.min(s.step + 1, ONBOARDING_TOTAL_STEPS - 1),
        })),

      prevStep: () =>
        set(s => ({
          step: Math.max(s.step - 1, 0),
        })),

      goToStep: (step: number) =>
        set({ step: Math.max(0, Math.min(step, ONBOARDING_TOTAL_STEPS - 1)) }),

      complete: () => set({ completed: true }),

      reset: () => set({ completed: false, step: 0 }),
    }),
    {
      name: 'cradle:onboarding:v1',
      storage: persistStorage,
      version: 1,
      partialize: state => ({
        completed: state.completed,
        step: state.step,
      }),
    },
  ),
)
