import { z } from 'zod'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from './persist-storage'
import type { ResolvedThemeMode } from './theme'

export type ThemeVariant = ResolvedThemeMode

export interface ThemeOverrides {
  accentColor: string | null
  backgroundColor: string | null
  foregroundColor: string | null
  uiFont: string | null
  codeFont: string | null
  translucentSidebar: boolean | null
  contrast: number | null
}

export interface ThemeProfile {
  id: string
  name: string
  variant: ThemeVariant
  overrides: ThemeOverrides
}

export interface ResolvedThemePreview {
  accentColor: string
  backgroundColor: string
  foregroundColor: string
  uiFont: string
  codeFont: string
  translucentSidebar: boolean
  contrast: number
}

interface ThemeCustomizationState {
  profiles: ThemeProfile[]
  activeProfileIds: Record<ThemeVariant, string>
  setActiveProfile: (variant: ThemeVariant, profileId: string) => void
  updateProfile: (profileId: string, patch: Partial<Omit<ThemeProfile, 'id' | 'variant'>>) => void
  updateOverrides: (profileId: string, patch: Partial<ThemeOverrides>) => void
  resetOverrides: (profileId: string) => void
  duplicateProfile: (profileId: string) => ThemeProfile | null
  importProfile: (profile: ThemeProfile) => void
}

const EMPTY_OVERRIDES: ThemeOverrides = {
  accentColor: null,
  backgroundColor: null,
  foregroundColor: null,
  uiFont: null,
  codeFont: null,
  translucentSidebar: null,
  contrast: null,
}

export const DEFAULT_THEME_PROFILES: ThemeProfile[] = [
  {
    id: 'cradle-light',
    name: 'Cradle Light',
    variant: 'light',
    overrides: { ...EMPTY_OVERRIDES },
  },
  {
    id: 'cradle-dark',
    name: 'Cradle Dark',
    variant: 'dark',
    overrides: { ...EMPTY_OVERRIDES },
  },
]

export const DEFAULT_ACTIVE_PROFILE_IDS: Record<ThemeVariant, string> = {
  light: 'cradle-light',
  dark: 'cradle-dark',
}

export const THEME_PREVIEW_DEFAULTS: Record<
  ThemeVariant,
  Pick<
    ResolvedThemePreview,
    'accentColor' | 'backgroundColor' | 'foregroundColor' | 'uiFont' | 'codeFont'
  >
> = {
  light: {
    accentColor: '#262626',
    backgroundColor: '#fafafa',
    foregroundColor: '#262626',
    uiFont: '\'Geist Variable\', sans-serif',
    codeFont: '\'Geist Mono\', monospace',
  },
  dark: {
    accentColor: '#f5f5f5',
    backgroundColor: '#191919',
    foregroundColor: '#f5f5f5',
    uiFont: '\'Geist Variable\', sans-serif',
    codeFont: '\'Geist Mono\', monospace',
  },
}

const importedThemeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  variant: z.enum(['light', 'dark']),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  foregroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  uiFont: z.string().trim().min(1).max(300),
  codeFont: z.string().trim().min(1).max(300),
  translucentSidebar: z.boolean(),
  contrast: z.number().min(0).max(100),
})

function createProfileId(variant: ThemeVariant): string {
  return `${variant}-${crypto.randomUUID()}`
}

export function parseThemeImport(source: string, id?: string): ThemeProfile {
  const imported = importedThemeSchema.parse(JSON.parse(source))
  return {
    id: id ?? createProfileId(imported.variant),
    name: imported.name,
    variant: imported.variant,
    overrides: {
      accentColor: imported.accentColor,
      backgroundColor: imported.backgroundColor,
      foregroundColor: imported.foregroundColor,
      uiFont: imported.uiFont,
      codeFont: imported.codeFont,
      translucentSidebar: imported.translucentSidebar,
      contrast: imported.contrast,
    },
  }
}

export function cloneThemeProfile(profile: ThemeProfile, id?: string): ThemeProfile {
  return {
    ...profile,
    id: id ?? createProfileId(profile.variant),
    name: `${profile.name} Copy`,
    overrides: { ...profile.overrides },
  }
}

export function selectActiveThemeProfile(
  state: Pick<ThemeCustomizationState, 'profiles' | 'activeProfileIds'>,
  variant: ThemeVariant,
): ThemeProfile {
  return (
    state.profiles.find(
      profile => profile.variant === variant && profile.id === state.activeProfileIds[variant],
    ) ?? DEFAULT_THEME_PROFILES.find(profile => profile.variant === variant)!
  )
}

export function resolveThemePreview(profile: ThemeProfile): ResolvedThemePreview {
  const defaults = THEME_PREVIEW_DEFAULTS[profile.variant]
  return {
    accentColor: profile.overrides.accentColor ?? defaults.accentColor,
    backgroundColor: profile.overrides.backgroundColor ?? defaults.backgroundColor,
    foregroundColor: profile.overrides.foregroundColor ?? defaults.foregroundColor,
    uiFont: profile.overrides.uiFont ?? defaults.uiFont,
    codeFont: profile.overrides.codeFont ?? defaults.codeFont,
    translucentSidebar: profile.overrides.translucentSidebar ?? false,
    contrast: profile.overrides.contrast ?? 50,
  }
}

export const useThemeCustomizationStore = create<ThemeCustomizationState>()(
  persist(
    (set, get) => ({
      profiles: DEFAULT_THEME_PROFILES.map(profile => ({
        ...profile,
        overrides: { ...profile.overrides },
      })),
      activeProfileIds: { ...DEFAULT_ACTIVE_PROFILE_IDS },
      setActiveProfile: (variant, profileId) =>
        set((state) => {
          if (
            !state.profiles.some(
              profile => profile.variant === variant && profile.id === profileId,
            )
          ) {
            return state
          }
          return { activeProfileIds: { ...state.activeProfileIds, [variant]: profileId } }
        }),
      updateProfile: (profileId, patch) =>
        set(state => ({
          profiles: state.profiles.map(profile =>
            profile.id === profileId ? { ...profile, ...patch } : profile),
        })),
      updateOverrides: (profileId, patch) =>
        set(state => ({
          profiles: state.profiles.map(profile =>
            profile.id === profileId
              ? { ...profile, overrides: { ...profile.overrides, ...patch } }
              : profile),
        })),
      resetOverrides: profileId =>
        set(state => ({
          profiles: state.profiles.map(profile =>
            profile.id === profileId
              ? { ...profile, overrides: { ...EMPTY_OVERRIDES } }
              : profile),
        })),
      duplicateProfile: (profileId) => {
        const source = get().profiles.find(profile => profile.id === profileId)
        if (!source) {
          return null
        }
        const duplicate = cloneThemeProfile(source)
        set(state => ({
          profiles: [...state.profiles, duplicate],
          activeProfileIds: { ...state.activeProfileIds, [duplicate.variant]: duplicate.id },
        }))
        return duplicate
      },
      importProfile: profile =>
        set(state => ({
          profiles: [...state.profiles, profile],
          activeProfileIds: { ...state.activeProfileIds, [profile.variant]: profile.id },
        })),
    }),
    {
      name: 'cradle:theme-customization:v1',
      storage: persistStorage,
      version: 1,
      partialize: state => ({
        profiles: state.profiles,
        activeProfileIds: state.activeProfileIds,
      }),
    },
  ),
)
