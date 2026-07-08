import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

export interface TerminalPreferencesState {
  fontFamily: string | null
  setFontFamily: (fontFamily: string | null | undefined) => void
  resetFontFamily: () => void
}

export function normalizeTerminalFontFamily(fontFamily: string | null | undefined): string | null {
  const trimmed = fontFamily?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export const useTerminalPreferencesStore = create<TerminalPreferencesState>()(
  persist(
    set => ({
      fontFamily: null,
      setFontFamily: fontFamily => set({ fontFamily: normalizeTerminalFontFamily(fontFamily) }),
      resetFontFamily: () => set({ fontFamily: null }),
    }),
    {
      name: 'cradle:terminal-preferences:v1',
      storage: persistStorage,
      version: 1,
    },
  ),
)
