import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

const MAX_DISMISSED_IDENTITIES = 100

interface BackgroundActivityFooterDismissalState {
  dismissedIdentities: string[]
  dismiss: (identity: string) => void
  dismissMany: (identities: readonly string[]) => void
}

function appendDismissed(current: string[], incoming: readonly string[]): string[] {
  const next = new Set(current)
  for (const identity of incoming) {
    next.add(identity)
  }
  return Array.from(next).slice(-MAX_DISMISSED_IDENTITIES)
}

export const useBackgroundActivityFooterDismissalStore
  = create<BackgroundActivityFooterDismissalState>()(
    persist(
      set => ({
        dismissedIdentities: [],
        dismiss: identity => set(state => ({
          dismissedIdentities: appendDismissed(state.dismissedIdentities, [identity]),
        })),
        dismissMany: identities => set(state => ({
          dismissedIdentities: appendDismissed(state.dismissedIdentities, identities),
        })),
      }),
      {
        name: 'cradle:background-activity-footer:v1',
        storage: persistStorage,
        partialize: state => ({ dismissedIdentities: state.dismissedIdentities }),
        version: 1,
      },
    ),
  )
