import type { AnimationPresetName } from '@cradle/streamdown'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from './persist-storage'

const FIXED_STREAMDOWN_SETTINGS = {
  animationPreset: 'balanced',
  animateMode: 'char',
  showCursor: false,
} as const

export const STREAMDOWN_RENDER_OPTIONS = FIXED_STREAMDOWN_SETTINGS

interface StreamdownState {
  animationPreset: AnimationPresetName
  animateMode: 'char' | 'word'
  showCursor: boolean
  setAnimationPreset: (p: AnimationPresetName) => void
  setAnimateMode: (m: 'char' | 'word') => void
  setShowCursor: (v: boolean) => void
}

export const useStreamdownStore = create<StreamdownState>()(
  persist(
    set => ({
      ...FIXED_STREAMDOWN_SETTINGS,
      setAnimationPreset: () => set(FIXED_STREAMDOWN_SETTINGS),
      setAnimateMode: () => set(FIXED_STREAMDOWN_SETTINGS),
      setShowCursor: () => set(FIXED_STREAMDOWN_SETTINGS),
    }),
    {
      name: 'cradle:streamdown:v1',
      storage: persistStorage,
      version: 2,
      migrate: () => FIXED_STREAMDOWN_SETTINGS,
      merge: (_persistedState, currentState) => ({
        ...currentState,
        ...FIXED_STREAMDOWN_SETTINGS,
      }),
    },
  ),
)
