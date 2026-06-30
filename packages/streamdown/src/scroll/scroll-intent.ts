import { useCallback, useEffect, useRef, useState } from 'react'

interface ScrollIntentState {
  isUserScrolling: boolean
  lastInteractionTime: number
}

const INTENT_TTL = 1200

/**
 * Hook that detects user scroll intent via capture-phase events.
 * Returns whether user is actively scrolling (disables auto-follow).
 *
 * Detection methods:
 * - wheel events (capture phase)
 * - pointerdown on scrollable container
 * - keyboard (PageUp/Down, ArrowUp/Down, Home/End)
 * - touch start/move
 *
 * TTL: 1200ms after last interaction, intent expires.
 */
export function useScrollIntent(containerRef: React.RefObject<HTMLElement | null>): {
  isUserScrolling: boolean
  reset: () => void
} {
  const stateRef = useRef<ScrollIntentState>({
    isUserScrolling: false,
    lastInteractionTime: 0,
  })
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const rafRef = useRef<number | null>(null)

  const markInteraction = useCallback(() => {
    stateRef.current.lastInteractionTime = Date.now()
    if (!stateRef.current.isUserScrolling) {
      stateRef.current.isUserScrolling = true
      setIsUserScrolling(true)
    }
  }, [])

  const reset = useCallback(() => {
    stateRef.current.isUserScrolling = false
    stateRef.current.lastInteractionTime = 0
    setIsUserScrolling(false)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const onWheel = () => markInteraction()
    const onPointerDown = () => markInteraction()
    const onTouchStart = () => markInteraction()
    const onTouchMove = () => markInteraction()

    const onKeyDown = (e: KeyboardEvent) => {
      const scrollKeys = new Set([
        'PageUp',
'PageDown',
'ArrowUp',
'ArrowDown',
'Home',
'End',
      ])
      if (scrollKeys.has(e.key)) {
        markInteraction()
      }
    }

    container.addEventListener('wheel', onWheel, { capture: true, passive: true })
    container.addEventListener('pointerdown', onPointerDown, { capture: true })
    container.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    container.addEventListener('touchmove', onTouchMove, { capture: true, passive: true })
    document.addEventListener('keydown', onKeyDown, { capture: true })

    const checkTTL = () => {
      const { lastInteractionTime, isUserScrolling: scrolling } = stateRef.current
      if (scrolling && Date.now() - lastInteractionTime > INTENT_TTL) {
        stateRef.current.isUserScrolling = false
        setIsUserScrolling(false)
      }
      rafRef.current = requestAnimationFrame(checkTTL)
    }
    rafRef.current = requestAnimationFrame(checkTTL)

    return () => {
      container.removeEventListener('wheel', onWheel, { capture: true })
      container.removeEventListener('pointerdown', onPointerDown, { capture: true })
      container.removeEventListener('touchstart', onTouchStart, { capture: true })
      container.removeEventListener('touchmove', onTouchMove, { capture: true })
      document.removeEventListener('keydown', onKeyDown, { capture: true })
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [containerRef, markInteraction])

  return { isUserScrolling, reset }
}
