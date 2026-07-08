import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  normalizeTerminalFontFamily,
  resolveTerminalFontFamily,
  useTerminalPreferencesStore,
} from './terminal-preferences'

afterEach(() => {
  useTerminalPreferencesStore.getState().resetFontFamily()
  if (typeof localStorage !== 'undefined') {
    localStorage.clear()
  }
})

describe('terminal preferences', () => {
  it('normalizes blank font family values to null', () => {
    expect(normalizeTerminalFontFamily(null)).toBeNull()
    expect(normalizeTerminalFontFamily(undefined)).toBeNull()
    expect(normalizeTerminalFontFamily('   ')).toBeNull()
  })

  it('trims custom font family values', () => {
    expect(normalizeTerminalFontFamily('  MesloLGM Nerd Font Mono  ')).toBe('MesloLGM Nerd Font Mono')
  })

  it('uses the default terminal font chain when no custom font is set', () => {
    expect(resolveTerminalFontFamily(null)).toBe(DEFAULT_TERMINAL_FONT_FAMILY)
  })

  it('prepends the custom font before the default fallback chain', () => {
    expect(resolveTerminalFontFamily('MesloLGM Nerd Font Mono')).toBe(
      `MesloLGM Nerd Font Mono, ${DEFAULT_TERMINAL_FONT_FAMILY}`,
    )
  })

  it('stores normalized custom terminal font preferences', () => {
    const store = useTerminalPreferencesStore.getState()

    store.setFontFamily('  CaskaydiaCove Nerd Font  ')

    expect(useTerminalPreferencesStore.getState().fontFamily).toBe('CaskaydiaCove Nerd Font')
  })

  it('resets custom terminal font preferences', () => {
    const store = useTerminalPreferencesStore.getState()

    store.setFontFamily('CaskaydiaCove Nerd Font')
    store.resetFontFamily()

    expect(useTerminalPreferencesStore.getState().fontFamily).toBeNull()
  })
})
