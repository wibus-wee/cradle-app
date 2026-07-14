import { createContext, useContext } from 'react'

import type { WorkspaceSession } from '../use-session'

export type PreviewCardPlacement = 'bottom' | 'right'

interface SessionPreviewTarget {
  kind: 'session'
  session: WorkspaceSession
  anchor: HTMLElement
  placement: PreviewCardPlacement
}

export type PreviewCardTarget = SessionPreviewTarget

export interface PreviewCardContextValue {
  show: (target: PreviewCardTarget) => void
  hide: () => void
  dismiss: () => void
}

export const PreviewCardContext = createContext<PreviewCardContextValue | null>(null)

export function usePreviewCard(): PreviewCardContextValue {
  const context = useContext(PreviewCardContext)
  if (!context) {
    throw new Error('usePreviewCard must be used within PreviewCardProvider')
  }
  return context
}
