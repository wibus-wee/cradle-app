import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { PreviewCardContextValue, PreviewCardTarget } from './preview-card-context'
import {
  PreviewCardContext,
} from './preview-card-context'
import { SessionPreviewCard } from './session/session-preview-card'

const PREVIEW_CARD_OPEN_DELAY_MS = 700
const PREVIEW_CARD_CLOSE_DELAY_MS = 120

export function PreviewCardProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<PreviewCardTarget | null>(null)
  const [open, setOpen] = useState(false)
  const instantRef = useRef(false)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }, [])

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const show = useCallback((nextTarget: PreviewCardTarget) => {
    clearCloseTimer()
    clearOpenTimer()
    setTarget(nextTarget)

    if (instantRef.current) {
      setOpen(true)
      return
    }

    openTimerRef.current = window.setTimeout(() => {
      instantRef.current = true
      setOpen(true)
      openTimerRef.current = null
    }, PREVIEW_CARD_OPEN_DELAY_MS)
  }, [clearCloseTimer, clearOpenTimer])

  const hide = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      instantRef.current = false
      setOpen(false)
      setTarget(null)
      closeTimerRef.current = null
    }, PREVIEW_CARD_CLOSE_DELAY_MS)
  }, [clearCloseTimer, clearOpenTimer])

  const dismiss = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    instantRef.current = false
    setOpen(false)
    setTarget(null)
  }, [clearCloseTimer, clearOpenTimer])

  useEffect(() => {
    return () => {
      clearOpenTimer()
      clearCloseTimer()
    }
  }, [clearCloseTimer, clearOpenTimer])

  const context = useMemo<PreviewCardContextValue>(() => ({
    show,
    hide,
    dismiss,
  }), [dismiss, hide, show])

  return (
    <PreviewCardContext value={context}>
      {children}
      {target?.kind === 'session'
        ? (
            <SessionPreviewCard
              target={target}
              placement={target.placement}
              open={open}
              onPointerEnter={clearCloseTimer}
              onPointerLeave={hide}
            />
          )
        : null}
    </PreviewCardContext>
  )
}
