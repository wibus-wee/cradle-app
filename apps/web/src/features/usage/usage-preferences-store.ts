import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

import type { UsageRangeKey } from './usage-time-range'
import { isUsageRangeKey } from './usage-time-range'

interface UsagePreferencesState {
  range: UsageRangeKey
  setRange: (range: UsageRangeKey) => void
}

interface PersistedUsagePreferences {
  range?: unknown
}

const DEFAULT_RANGE: UsageRangeKey = '30d'

export const useUsagePreferencesStore = create<UsagePreferencesState>()(
  persist(
    set => ({
      range: DEFAULT_RANGE,
      setRange: range => set({ range }),
    }),
    {
      name: 'cradle:usage-preferences:v1',
      storage: persistStorage,
      partialize: state => ({ range: state.range }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedUsagePreferences | undefined
        return {
          ...currentState,
          range: isUsageRangeKey(persisted?.range) ? persisted.range : DEFAULT_RANGE,
        }
      },
    },
  ),
)
