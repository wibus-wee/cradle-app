import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

interface CredentialSetupState {
  /** True once the user has configured a provider, picked cc-switch, or explicitly skipped. */
  completed: boolean
  /** True if the user dismissed the dialog without configuring anything. */
  skipped: boolean
  complete: () => void
  skip: () => void
  reset: () => void
}

/**
 * First-run credential setup gate. Sits between onboarding completion and the
 * main app: once onboarding is done we surface a dialog nudging the user to
 * configure an AI provider (or adopt their existing cc-switch setup). The
 * dialog stops appearing once `completed` is true.
 */
export const useCredentialSetupStore = create<CredentialSetupState>()(
  persist(
    set => ({
      completed: false,
      skipped: false,

      complete: () => set({ completed: true, skipped: false }),
      skip: () => set({ completed: true, skipped: true }),
      reset: () => set({ completed: false, skipped: false }),
    }),
    {
      name: 'cradle:credential-setup:v1',
      storage: persistStorage,
      version: 1,
      partialize: state => ({ completed: state.completed, skipped: state.skipped }),
    },
  ),
)
