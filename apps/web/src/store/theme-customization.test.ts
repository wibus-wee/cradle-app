import { afterEach, describe, expect, it } from 'vitest'

import { getAppTerminalTheme } from '~/features/tui/app-theme'

import {
  cloneThemeProfile,
  DEFAULT_THEME_PROFILES,
  parseThemeImport,
  resolveThemePreview,
} from './theme-customization'
import { applyThemeProfile } from './theme-customization-runtime'

const IMPORTED_THEME = JSON.stringify({
  name: 'Paper',
  variant: 'light',
  accentColor: '#2563eb',
  backgroundColor: '#fffdf8',
  foregroundColor: '#292524',
  uiFont: 'Inter, sans-serif',
  codeFont: 'Berkeley Mono, monospace',
  translucentSidebar: true,
  contrast: 64,
})

afterEach(() => {
  document.documentElement.removeAttribute('style')
  document.documentElement.classList.remove('dark')
  delete document.documentElement.dataset.themeProfile
  delete document.documentElement.dataset.themeCodeFont
  delete document.documentElement.dataset.themeTranslucentSidebar
})

describe('theme customization', () => {
  it('imports a complete theme without changing its values', () => {
    const profile = parseThemeImport(IMPORTED_THEME, 'paper-light')

    expect(profile).toEqual({
      id: 'paper-light',
      name: 'Paper',
      variant: 'light',
      overrides: {
        accentColor: '#2563eb',
        backgroundColor: '#fffdf8',
        foregroundColor: '#292524',
        uiFont: 'Inter, sans-serif',
        codeFont: 'Berkeley Mono, monospace',
        translucentSidebar: true,
        contrast: 64,
      },
    })
  })

  it('rejects invalid theme colors', () => {
    expect(() => parseThemeImport(IMPORTED_THEME.replace('#2563eb', 'blue'), 'invalid')).toThrow()
  })

  it('duplicates overrides without sharing their object identity', () => {
    const source = parseThemeImport(IMPORTED_THEME, 'paper-light')
    const copy = cloneThemeProfile(source, 'paper-copy')

    expect(copy.name).toBe('Paper Copy')
    expect(copy.overrides).toEqual(source.overrides)
    expect(copy.overrides).not.toBe(source.overrides)
  })

  it('keeps the built-in palette untouched when no overrides are configured', () => {
    const profile = DEFAULT_THEME_PROFILES[0]!
    const removeProfile = applyThemeProfile(profile, 'light')

    expect(document.documentElement.style.getPropertyValue('--background')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--foreground')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
    expect(resolveThemePreview(profile).backgroundColor).toBe('#fafafa')

    removeProfile()
  })

  it('applies and removes only explicit overrides', () => {
    const profile = parseThemeImport(IMPORTED_THEME, 'paper-light')
    const removeProfile = applyThemeProfile(profile, 'light')

    expect(document.documentElement.style.getPropertyValue('--background')).toBe('#fffdf8')
    expect(document.documentElement.style.getPropertyValue('--foreground')).toBe('#292524')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#2563eb')
    expect(document.documentElement.dataset.themeCodeFont).toBe('true')

    removeProfile()

    expect(document.documentElement.style.getPropertyValue('--background')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
    expect(document.documentElement.dataset.themeCodeFont).toBeUndefined()
  })

  it('preserves the terminal palette until a theme color is explicitly overridden', () => {
    expect(getAppTerminalTheme()).toMatchObject({
      background: '#ffffff',
      foreground: '#333333',
      selectionBackground: '#add6ff',
      selectionForeground: '#000000',
    })

    const profile = parseThemeImport(IMPORTED_THEME, 'paper-light')
    const removeProfile = applyThemeProfile(profile, 'light')

    expect(getAppTerminalTheme()).toMatchObject({
      background: '#fffdf8',
      foreground: '#292524',
      selectionBackground: '#2563eb66',
      selectionForeground: '#292524',
    })

    removeProfile()
  })
})
