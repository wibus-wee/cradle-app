import { useCallback, useRef, useState } from 'react'

interface SpringConfig {
  stiffness: number
  damping: number
  mass: number
  threshold: number
}

const DEFAULT_CONFIG: SpringConfig = {
  stiffness: 0.05,
  damping: 0.7,
  mass: 1.25,
  threshold: 0.5,
}

/**
 * Spring physics scroll-to-bottom.
 * velocity = (DAMPING * v + STIFFNESS * distance) / MASS per RAF frame.
 * Provides natural deceleration approaching target.
 */
export function useSpringScroll(
  containerRef: React.RefObject<HTMLElement | null>,
  config?: Partial<SpringConfig>,
): {
  scrollToBottom: () => void
  stop: () => void
  isAnimating: boolean
} {
  const cfg: SpringConfig = { ...DEFAULT_CONFIG, ...config }
  const velocityRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    velocityRef.current = 0
    setIsAnimating(false)
  }, [])

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    // Already at bottom
    const maxScroll = container.scrollHeight - container.clientHeight
    if (maxScroll - container.scrollTop < 1) {
      return
    }

    setIsAnimating(true)

    const tick = () => {
      const el = containerRef.current
      if (!el) {
        stop()
        return
      }

      const target = el.scrollHeight - el.clientHeight
      const distance = target - el.scrollTop

      // Spring force: F = stiffness * distance
      // Damped velocity: v = (damping * v + stiffness * distance) / mass
      velocityRef.current
        = (cfg.damping * velocityRef.current + cfg.stiffness * distance) / cfg.mass

      el.scrollTop += velocityRef.current

      // Stop condition: velocity below threshold and close to target
      if (Math.abs(velocityRef.current) < cfg.threshold && Math.abs(distance) < 1) {
        el.scrollTop = target
        stop()
        return
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    // Cancel any existing animation
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [containerRef, cfg.stiffness, cfg.damping, cfg.mass, cfg.threshold, stop])

  return { scrollToBottom, stop, isAnimating }
}
