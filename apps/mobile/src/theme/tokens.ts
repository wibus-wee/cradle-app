import type { ColorSchemeName } from 'react-native'

const light = {
  background: '#fafafa',
  foreground: '#262626',
  card: '#ffffff',
  muted: '#f2f2f2',
  mutedForeground: '#737373',
  border: 'rgba(0, 0, 0, 0.08)',
  input: 'rgba(0, 0, 0, 0.10)',
  primary: '#262626',
  primaryForeground: '#fafafa',
  info: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  destructive: '#ef4444',
  overlay: 'rgba(0, 0, 0, 0.28)',
  shadow: '#000000',
} as const

const dark = {
  background: '#0f0f0f',
  foreground: '#f5f5f5',
  card: '#141414',
  muted: '#1c1c1c',
  mutedForeground: '#a3a3a3',
  border: 'rgba(255, 255, 255, 0.08)',
  input: 'rgba(255, 255, 255, 0.10)',
  primary: '#f5f5f5',
  primaryForeground: '#262626',
  info: '#60a5fa',
  success: '#34d399',
  warning: '#fbbf24',
  destructive: '#f87171',
  overlay: 'rgba(0, 0, 0, 0.64)',
  shadow: '#000000',
} as const

export type Theme = { [K in keyof typeof light]: string }

export function getTheme(scheme: ColorSchemeName): Theme {
  return scheme === 'dark' ? dark : light
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
} as const
