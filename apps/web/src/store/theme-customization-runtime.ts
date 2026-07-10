import type { ThemeProfile, ThemeVariant } from './theme-customization'

const ACCENT_PROPERTIES = ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring'] as const
const FONT_PROPERTIES = ['--font-sans', '--font-heading'] as const

export function applyThemeProfile(profile: ThemeProfile, variant: ThemeVariant): () => void {
  const root = document.documentElement
  const appliedProperties = new Set<string>()

  const applyProperty = (property: string, value: string): void => {
    root.style.setProperty(property, value)
    appliedProperties.add(property)
  }

  root.dataset.themeProfile = profile.id

  if (profile.overrides.accentColor) {
    for (const property of ACCENT_PROPERTIES) {
      applyProperty(property, profile.overrides.accentColor)
    }
  }
  if (profile.overrides.backgroundColor) {
    applyProperty('--background', profile.overrides.backgroundColor)
  }
  if (profile.overrides.foregroundColor) {
    applyProperty('--foreground', profile.overrides.foregroundColor)
  }
  if (profile.overrides.uiFont) {
    for (const property of FONT_PROPERTIES) {
      applyProperty(property, profile.overrides.uiFont)
    }
  }
  if (profile.overrides.codeFont) {
    applyProperty('--font-mono', profile.overrides.codeFont)
    root.dataset.themeCodeFont = 'true'
  }
  if (profile.overrides.contrast !== null) {
    const strength = Math.round(52 + profile.overrides.contrast * 0.28)
    const borderStrength = Math.round(5 + profile.overrides.contrast * 0.09)
    applyProperty(
      '--muted-foreground',
      `color-mix(in srgb, var(--foreground) ${strength}%, var(--background))`,
    )
    applyProperty(
      '--border',
      `color-mix(in srgb, var(--foreground) ${borderStrength}%, transparent)`,
    )
  }
  if (profile.overrides.translucentSidebar === true) {
    const sidebar = getComputedStyle(root).getPropertyValue('--sidebar').trim()
    if (sidebar) {
      applyProperty('--sidebar', `color-mix(in srgb, ${sidebar} 76%, transparent)`)
    }
    root.dataset.themeTranslucentSidebar = 'true'
  }

  root.style.colorScheme = variant

  return () => {
    for (const property of appliedProperties) {
      root.style.removeProperty(property)
    }
    root.style.removeProperty('color-scheme')
    delete root.dataset.themeProfile
    delete root.dataset.themeCodeFont
    delete root.dataset.themeTranslucentSidebar
  }
}
