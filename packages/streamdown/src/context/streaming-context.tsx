import type { ReactNode } from 'react'
import * as React from 'react'
import { createContext, useContext, useMemo } from 'react'

import type { SmoothPreset } from '../hooks/use-smooth-content'

interface StreamingContextValue {
  /** Whether content is currently streaming */
  streaming: boolean
  /** CPS smoother preset */
  preset: SmoothPreset
  /** Animation granularity */
  animateMode: 'char' | 'word'
  /** Whether the streaming CSS gate is active (delayed false) */
  animatedActive: boolean
}

const StreamingCtx = createContext<StreamingContextValue>({
  streaming: false,
  preset: 'balanced',
  animateMode: 'word',
  animatedActive: false,
})

interface StreamingProviderProps {
  children: ReactNode
  streaming: boolean
  preset?: SmoothPreset
  animateMode?: 'char' | 'word'
  animatedActive?: boolean
}

export function StreamingProvider({
  children,
  streaming,
  preset = 'balanced',
  animateMode = 'word',
  animatedActive = false,
}: StreamingProviderProps) {
  const value = useMemo(() => ({
    streaming,
    preset,
    animateMode,
    animatedActive,
  }), [streaming, preset, animateMode, animatedActive])

  return <StreamingCtx.Provider value={value}>{children}</StreamingCtx.Provider>
}

export function useStreamingContext(): StreamingContextValue {
  return useContext(StreamingCtx)
}
