import { useEffect, useRef } from 'react'

import { readUltraThinkingActivatedAt } from '~/features/composer-toolbar/ultra-thinking-activation'
import { cn } from '~/lib/cn'

const GRID_SPACING = 14
const PARTICLE_COUNT = 36
const WAVE_SPEED = 1.4
const WAVE_FREQUENCY = 0.05
const STATIC_FRAME_TIME = 1.4
/** Seconds for the activation wavefront to sweep across the whole composer. */
const INTRO_DURATION = 1.15
/** Thickness (px) of the bright band trailing the activation wavefront. */
const INTRO_BAND = 90

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function readRoseColor(): [number, number, number] {
  const hasDark = document.documentElement.classList.contains('dark')
  const hasLight = document.documentElement.classList.contains('light')
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  return hasDark || (!hasLight && sysDark) ? [253, 164, 175] : [225, 29, 72]
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Rose-tinted grid wave + drifting particles painted inside the composer while
 * the "ultra" thinking effort is selected. The wave radiates gently from the
 * thinking-effort button across the whole composer. When the user just switched
 * to ultra (see `ultra-thinking-activation`), a bright wavefront first expands
 * outward from the button and ignites the grid as it passes; when ultra was
 * already selected before mount, only the settled ambient wave is shown.
 */
export function UltraThinkingDecoration({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // The activation sweep only plays when the user explicitly selected ultra a
    // moment ago; its clock is anchored to the click so the sweep is continuous
    // with the interaction. Page loads with ultra already on skip it entirely.
    const activatedAt = readUltraThinkingActivatedAt()
    const introEnabled = !reduceMotion && performance.now() - activatedAt < INTRO_DURATION * 1000
    let width = 0
    let height = 0
    let frameId = 0
    let disposed = false
    let isIntersecting = true
    let origin = { x: 24, y: 0 }
    let maxDistance = 1
    let particles: Array<{ x: number, y: number, seed: number }> = []

    const syncSize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      width = rect.width
      height = rect.height
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Anchor the wave at the thinking-effort trigger when it is visible.
      const root = canvas.closest('[data-composer-action-target]')
      const trigger = root?.querySelector('[data-thinking-effort]')
      if (trigger) {
        const triggerRect = trigger.getBoundingClientRect()
        origin = {
          x: triggerRect.left + triggerRect.width / 2 - rect.left,
          y: triggerRect.top + triggerRect.height / 2 - rect.top,
        }
      }
      else {
        origin = { x: 24, y: height - 16 }
      }
      const cornerDistance = (x: number, y: number) =>
        Math.sqrt((x - origin.x) ** 2 + (y - origin.y) ** 2)
      maxDistance = Math.max(
        cornerDistance(0, 0),
        cornerDistance(width, 0),
        cornerDistance(0, height),
        cornerDistance(width, height),
        1,
      )

      particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
        x: seededUnit(index, 71) * width,
        y: seededUnit(index, 83) * height,
        seed: seededUnit(index, 97),
      }))
    }

    const paint = (time: number) => {
      ctx.clearRect(0, 0, width, height)
      const [cr, cg, cb] = readRoseColor()
      const introProgress = introEnabled ? clamp01(time / INTRO_DURATION) : 1
      const wavefront = easeOutCubic(introProgress) * maxDistance
      const introActive = introProgress < 1
      // Ambient field ramps in behind the wavefront, then stays.
      const ambientLevel = introEnabled ? clamp01(time / (INTRO_DURATION * 0.9)) : 1

      // Dense fine grid — a soft radial wave emanating from the trigger.
      const cols = Math.ceil(width / GRID_SPACING)
      const rows = Math.ceil(height / GRID_SPACING)
      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const x = col * GRID_SPACING
          const y = row * GRID_SPACING
          const distance = Math.sqrt((x - origin.x) ** 2 + (y - origin.y) ** 2)
          if (distance > wavefront) {
            continue
          }
          const falloff = Math.max(0, 1 - distance / (maxDistance * 0.85))
          if (falloff <= 0) {
            continue
          }
          const wave = Math.sin(distance * WAVE_FREQUENCY - time * WAVE_SPEED) * 0.5 + 0.5
          // Bright ignition flash right where the wavefront just passed.
          const ignition = introActive ? Math.max(0, 1 - (wavefront - distance) / INTRO_BAND) : 0
          const energy = Math.min(1, wave * ambientLevel + ignition)
          const radius = (0.35 + (1.05 + ignition * 1.2) * energy) * (0.45 + 0.55 * falloff)
          const alpha = ((0.04 + 0.13 * wave) * ambientLevel + ignition * 0.4) * falloff
          if (alpha <= 0.004) {
            continue
          }
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // The wavefront ring itself — visible while the sweep is running.
      if (introActive && wavefront > 0.5) {
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(0.35 * (1 - introProgress)).toFixed(3)})`
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.arc(origin.x, origin.y, wavefront, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Small drifting particles with a soft twinkle.
      for (const particle of particles) {
        const orbit = time * (0.22 + particle.seed * 0.3)
        const x = particle.x + Math.cos(orbit + particle.seed * Math.PI * 2) * 10
        const y = particle.y + Math.sin(orbit * 0.8 + particle.seed * Math.PI * 4) * 7
        const distance = Math.sqrt((particle.x - origin.x) ** 2 + (particle.y - origin.y) ** 2)
        const revealed = clamp01((wavefront - distance) / 60)
        if (revealed <= 0) {
          continue
        }
        const twinkle = Math.sin(time * 1.3 + particle.seed * Math.PI * 6) * 0.5 + 0.5
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${((0.1 + 0.24 * twinkle) * revealed).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(x, y, 0.7 + twinkle * 0.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const startTime = introEnabled ? activatedAt : performance.now()
    const frame = (now: number) => {
      frameId = 0
      if (disposed) {
        return
      }
      paint((now - startTime) / 1000)
      frameId = requestAnimationFrame(frame)
    }
    const updatePlayback = () => {
      if (reduceMotion || disposed) {
        return
      }
      const shouldRun = isIntersecting && document.visibilityState === 'visible'
      if (shouldRun && frameId === 0) {
        frameId = requestAnimationFrame(frame)
      }
      else if (!shouldRun && frameId !== 0) {
        cancelAnimationFrame(frameId)
        frameId = 0
      }
    }

    syncSize()
    if (reduceMotion) {
      paint(STATIC_FRAME_TIME)
    }
    else {
      updatePlayback()
    }

    const handleVisibilityChange = () => {
      updatePlayback()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const resizeObserver = new ResizeObserver(() => {
      syncSize()
      if (reduceMotion) {
        paint(STATIC_FRAME_TIME)
      }
    })
    resizeObserver.observe(canvas)

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isIntersecting = Boolean(entry?.isIntersecting)
      updatePlayback()
    })
    intersectionObserver.observe(canvas)

    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className={cn('size-full', className)} />
}
