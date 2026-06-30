import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from './persist-storage'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

function readSystemThemeMode(): ResolvedThemeMode {
  if (typeof window !== 'undefined' && window.matchMedia(SYSTEM_DARK_QUERY).matches) {
    return 'dark'
  }
  return 'light'
}

export function resolveThemeMode(mode: ThemeMode, systemMode: ResolvedThemeMode): ResolvedThemeMode {
  return mode === 'system' ? systemMode : mode
}

export function useResolvedThemeMode(): ResolvedThemeMode {
  const mode = useThemeStore(s => s.mode)
  const [systemMode, setSystemMode] = useState<ResolvedThemeMode>(() => readSystemThemeMode())

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mq = window.matchMedia(SYSTEM_DARK_QUERY)
    const updateSystemMode = (): void => {
      setSystemMode(mq.matches ? 'dark' : 'light')
    }

    updateSystemMode()
    if (mode !== 'system') {
      return
    }

    mq.addEventListener('change', updateSystemMode)
    return () => mq.removeEventListener('change', updateSystemMode)
  }, [mode])

  return resolveThemeMode(mode, systemMode)
}

export const useThemeStore = create<ThemeState>()(
  persist(
    set => ({
      mode: 'system',
      setMode: mode => set({ mode }),
    }),
    {
      name: 'cradle:theme:v1',
      storage: persistStorage,
      version: 1,
    },
  ),
)
