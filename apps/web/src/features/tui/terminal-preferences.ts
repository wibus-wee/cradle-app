import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

export const DEFAULT_TERMINAL_FONT_FAMILY = [
  '"Geist Mono"',
  '"GeistMono"',
  '"Cascadia Code"',
  '"Cascadia Mono"',
  '"Fira Mono"',
  '"MesloLGM Nerd Font Mono"',
  '"CaskaydiaCove Nerd Font"',
  '"CaskaydiaMono Nerd Font"',
  '"FiraCode Nerd Font Mono"',
  '"Symbols Nerd Font Mono"',
  '"PowerlineSymbols"',
  'ui-monospace',
  'monospace',
].join(', ')

export interface TerminalPreferencesState {
  fontFamily: string | null
  setFontFamily: (fontFamily: string | null | undefined) => void
  resetFontFamily: () => void
}

export function normalizeTerminalFontFamily(fontFamily: string | null | undefined): string | null {
  const trimmed = fontFamily?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export function resolveTerminalFontFamily(fontFamily: string | null | undefined): string {
  const normalized = normalizeTerminalFontFamily(fontFamily)
  return normalized ? `${normalized}, ${DEFAULT_TERMINAL_FONT_FAMILY}` : DEFAULT_TERMINAL_FONT_FAMILY
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
