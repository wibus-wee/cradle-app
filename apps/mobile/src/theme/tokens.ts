import type { ColorSchemeName } from 'react-native'

const light = {
  background: '#f5f5f5',
  foreground: '#262626',
  card: '#ffffff',
  surface: '#ffffff',
  glassTint: 'rgba(255, 255, 255, 0.30)',
  surfaceInset: '#f5f5f5',
  chrome: '#f5f5f5',
  muted: '#ebebeb',
  mutedForeground: '#737373',
  tertiaryForeground: '#595959',
  dimForeground: '#a3a3a3',
  border: 'rgba(0, 0, 0, 0.08)',
  chromeBorder: 'rgba(0, 0, 0, 0.06)',
  input: 'rgba(0, 0, 0, 0.10)',
  primary: '#262626',
  primaryForeground: '#ffffff',
  workspace: '#3b82f6',
  session: '#8b5cf6',
  global: '#0ea5e9',
  scope: '#10b981',
  agent: '#f43f5e',
  legacy: '#f59e0b',
  diff: '#f97316',
  summary: '#ec4899',
  info: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  destructive: '#ef4444',
  overlay: 'rgba(0, 0, 0, 0.28)',
  shadow: '#000000',
  shadowOpacity: 0.08,
  isDark: false,
} as const

const dark = {
  background: '#111111',
  foreground: '#f5f5f5',
  card: '#141414',
  surface: '#141414',
  glassTint: 'rgba(20, 20, 20, 0.30)',
  surfaceInset: '#111111',
  chrome: '#111111',
  muted: '#1a1a1a',
  mutedForeground: '#8a8a8a',
  tertiaryForeground: '#a3a3a3',
  dimForeground: '#404040',
  border: 'rgba(255, 255, 255, 0.06)',
  chromeBorder: 'rgba(255, 255, 255, 0.05)',
  input: 'rgba(255, 255, 255, 0.10)',
  primary: '#f5f5f5',
  primaryForeground: '#262626',
  workspace: '#60a5fa',
  session: '#a78bfa',
  global: '#38bdf8',
  scope: '#34d399',
  agent: '#fb7185',
  legacy: '#fbbf24',
  diff: '#fb923c',
  summary: '#f472b6',
  info: '#60a5fa',
  success: '#34d399',
  warning: '#fbbf24',
  destructive: '#f87171',
  overlay: 'rgba(0, 0, 0, 0.64)',
  shadow: '#000000',
  shadowOpacity: 0.30,
  isDark: true,
} as const

export type Theme = {
  [K in keyof typeof light]: (typeof light)[K] extends boolean
    ? boolean
    : (typeof light)[K] extends number
      ? number
      : string
}

export function getTheme(scheme: ColorSchemeName): Theme {
  return scheme === 'dark' ? dark : light
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 64,
} as const

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 16,
} as const
