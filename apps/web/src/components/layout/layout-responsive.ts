import { useSyncExternalStore } from 'react'

import { useLayoutStore } from '~/store/layout'

export const CHROME_CENTER_MIN_WIDTH = 760
export const CHROME_COLLAPSED_SIDEBAR_WIDTH = 48
export const CHROME_RESPONSIVE_GUTTER_WIDTH = 24

function readViewportWidth(): number {
  if (typeof window === 'undefined') {
    return 1440
  }

  return window.innerWidth
}

function subscribeViewportWidth(onChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  let frameId: number | null = null
  const handleResize = () => {
    if (frameId !== null) {
      return
    }

    frameId = window.requestAnimationFrame(() => {
      frameId = null
      onChange()
    })
  }

  window.addEventListener('resize', handleResize)
  return () => {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
    }
    window.removeEventListener('resize', handleResize)
  }
}

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribeViewportWidth, readViewportWidth, readViewportWidth)
}

export function useSidebarSheetMode(): boolean {
  const viewportWidth = useViewportWidth()
  const sidebarWidth = useLayoutStore(state => state.sidebarWidth)
  const sidebarCollapsed = useLayoutStore(state => state.sidebarCollapsed)
  const dockedSidebarWidth = sidebarCollapsed
    ? CHROME_COLLAPSED_SIDEBAR_WIDTH
    : sidebarWidth

  return viewportWidth < dockedSidebarWidth + CHROME_CENTER_MIN_WIDTH + CHROME_RESPONSIVE_GUTTER_WIDTH
}
