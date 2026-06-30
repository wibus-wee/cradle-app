import { useEffect, useRef, useState } from 'react'

/**
 * Propagates `true` immediately, delays `false` by `tailMs`.
 * Used to keep streaming CSS gate active after streaming ends.
 *
 * @param value - The input boolean (streaming state)
 * @param tailMs - Delay before propagating false (default 1000ms)
 * @returns Delayed boolean
 */
export function useDelayedAnimated(value: boolean, tailMs = 1000): boolean {
  const [delayed, setDelayed] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (value) {
      // Immediately propagate true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setDelayed(true)
    }
 else {
      // Delay propagating false
      timerRef.current = setTimeout(() => {
        setDelayed(false)
        timerRef.current = null
      }, tailMs)
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [value, tailMs])

  return delayed
}
