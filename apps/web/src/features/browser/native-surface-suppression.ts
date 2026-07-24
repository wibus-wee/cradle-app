// FILE: native-surface-suppression.ts
// Purpose: Reference-counts DOM overlays that must temporarily hide the native browser surface.
// Layer: Browser feature state

import { useEffect } from 'react'
import { create } from 'zustand'

interface NativeBrowserSurfaceSuppressionState {
  suppressCount: number
  acquire: () => () => void
}

export const useNativeBrowserSurfaceSuppressionStore
  = create<NativeBrowserSurfaceSuppressionState>(set => ({
    suppressCount: 0,
    acquire: () => {
      let released = false
      set(state => ({ suppressCount: state.suppressCount + 1 }))
      return () => {
        if (released) {
          return
        }
        released = true
        set(state => ({ suppressCount: Math.max(0, state.suppressCount - 1) }))
      }
    },
  }))

export function useSuppressNativeBrowserSurface(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return
    }
    return useNativeBrowserSurfaceSuppressionStore.getState().acquire()
  }, [active])
}
