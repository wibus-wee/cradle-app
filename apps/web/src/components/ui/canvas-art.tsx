import { cn } from '~/lib/cn'
import { useEffect, useRef } from 'react'

// ── Shared utilities ───────────────────────────────────────────────────────────

type DrawColor = [number, number, number]
type CanvasSize = { W: number, H: number }
type CanvasRuntime = {
  size: CanvasSize
  color: DrawColor
  theme: 'dark' | 'light'
  visible: boolean
  requestPaint: () => void
  cleanup: () => void
}

function readDrawColor(): DrawColor {
  const hasDark = document.documentElement.classList.contains('dark')
  const hasLight = document.documentElement.classList.contains('light')
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = hasDark || (!hasLight && sysDark)
  return isDark ? [210, 210, 210] : [60, 60, 60]
}

function readThemeMode(): 'dark' | 'light' {
  const hasDark = document.documentElement.classList.contains('dark')
  const hasLight = document.documentElement.classList.contains('light')
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  return hasDark || (!hasLight && sysDark) ? 'dark' : 'light'
}

function syncCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): CanvasSize {
  const dpr = window.devicePixelRatio || 1
  const W = Math.max(0, width)
  const H = Math.max(0, height)
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { W, H }
}

function createCanvasRuntime(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  paint: (runtime: CanvasRuntime) => void,
): CanvasRuntime {
  let isDocumentVisible = document.visibilityState === 'visible'
  let isIntersecting = true
  let frameId = 0
  let disposed = false
  const runtime: CanvasRuntime = {
    size: { W: 0, H: 0 },
    color: readDrawColor(),
    theme: readThemeMode(),
    visible: isDocumentVisible && isIntersecting,
    requestPaint: () => {},
    cleanup: () => {},
  }

  const requestPaint = () => {
    if (disposed || frameId !== 0) {
      return
    }
    frameId = requestAnimationFrame(() => {
      frameId = 0
      if (!disposed && isCanvasDrawable(runtime)) {
        paint(runtime)
      }
    })
  }
  runtime.requestPaint = requestPaint

  const refreshColor = () => {
    runtime.color = readDrawColor()
    runtime.theme = readThemeMode()
    requestPaint()
  }
  const refreshSize = (width: number, height: number) => {
    runtime.size = syncCanvas(canvas, ctx, width, height)
    requestPaint()
  }
  const refreshVisibility = () => {
    runtime.visible = isDocumentVisible && isIntersecting
    if (runtime.visible) {
      requestPaint()
    }
  }
  const rect = canvas.getBoundingClientRect()
  refreshSize(rect.width, rect.height)

  const cleanupCallbacks: Array<() => void> = []
  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) {
        return
      }
      refreshSize(entry.contentRect.width, entry.contentRect.height)
    })
    resizeObserver.observe(canvas)
    cleanupCallbacks.push(() => resizeObserver.disconnect())
  }
  else {
    const handleResize = () => {
      const nextRect = canvas.getBoundingClientRect()
      refreshSize(nextRect.width, nextRect.height)
    }
    window.addEventListener('resize', handleResize)
    cleanupCallbacks.push(() => window.removeEventListener('resize', handleResize))
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', refreshColor)
  cleanupCallbacks.push(() => mediaQuery.removeEventListener('change', refreshColor))

  if (typeof MutationObserver !== 'undefined') {
    const themeObserver = new MutationObserver(refreshColor)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    cleanupCallbacks.push(() => themeObserver.disconnect())
  }

  const handleVisibilityChange = () => {
    isDocumentVisible = document.visibilityState === 'visible'
    refreshVisibility()
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)
  cleanupCallbacks.push(() => document.removeEventListener('visibilitychange', handleVisibilityChange))

  if (typeof IntersectionObserver !== 'undefined') {
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isIntersecting = Boolean(entry?.isIntersecting)
      refreshVisibility()
    })
    intersectionObserver.observe(canvas)
    cleanupCallbacks.push(() => intersectionObserver.disconnect())
  }

  runtime.cleanup = () => {
    disposed = true
    cancelAnimationFrame(frameId)
    for (const cleanup of cleanupCallbacks) {
      cleanup()
    }
  }

  return runtime
}

function isCanvasDrawable(runtime: CanvasRuntime): boolean {
  return runtime.visible && runtime.size.W > 0 && runtime.size.H > 0
}

function seededUnit(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
  return value - Math.floor(value)
}

// ── Shared mouse tracking hook ──────────────────────────────────────────────────

function useCanvasMouse(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  active: boolean,
  onChangeRef?: React.RefObject<(() => void) | null>,
) {
  const mouseRef = useRef({ x: -9999, y: -9999 })

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return

    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.offsetX, y: e.offsetY }
      onChangeRef?.current?.()
    }
    const onLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 }
      onChangeRef?.current?.()
    }

    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    return () => {
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
    }
  }, [active, canvasRef, onChangeRef])

  return mouseRef
}

// ── 1. HalftoneArt ─────────────────────────────────────────────────────────────
// Radial sine wave dot grid. Dots vary by a fixed wave from the center, giving
// a classic dither / halftone print aesthetic without a continuous animation.

const HALFTONE_GRID = 18
const HALFTONE_MAX_R = 5.5

export function HalftoneArt({ className, interactive = false }: { className?: string; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const requestPaintRef = useRef<(() => void) | null>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive, requestPaintRef)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    const paint = (runtime: CanvasRuntime) => {
      const { W, H } = runtime.size
      ctx.clearRect(0, 0, W, H)
      const [cr, cg, cb] = runtime.color
      const phase = 0.8

      const cols = Math.ceil(W / HALFTONE_GRID) + 1
      const rows = Math.ceil(H / HALFTONE_GRID) + 1

      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const x = col * HALFTONE_GRID
          const y = row * HALFTONE_GRID
          const dx = x / W - 0.5
          const dy = y / H - 0.5
          const dist = Math.sqrt(dx * dx + dy * dy)
          const wave = Math.sin(phase - dist * 10 + col * 0.25 + row * 0.18)
          let radius = Math.max(0.5, HALFTONE_MAX_R * (wave * 0.5 + 0.5))
          let alpha = 0.10 + (wave * 0.5 + 0.5) * 0.28

          // Mouse spotlight: dots near cursor grow larger and brighter
          if (interactive) {
            const mdx = (x - mouseRef.current.x) / 130
            const mdy = (y - mouseRef.current.y) / 130
            const mdist = Math.sqrt(mdx * mdx + mdy * mdy)
            const spot = Math.max(0, 1 - mdist)
            radius *= 1 + spot * 0.7
            alpha = Math.min(1, alpha + spot * 0.18)
          }

          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }

    }

    const runtime = createCanvasRuntime(canvas, ctx, paint)
    requestPaintRef.current = runtime.requestPaint
    return () => {
      requestPaintRef.current = null
      runtime.cleanup()
    }
  }, [interactive, mouseRef, requestPaintRef])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

// ── 2. FlowField ───────────────────────────────────────────────────────────────
// Particles placed along a smooth vector field derived from sine-cosine noise.
// Each particle uses a locally computed offset for an organic, fluid look.

const FLOW_PARTICLE_COUNT = 180

export function FlowField({ className, interactive = false }: { className?: string; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const requestPaintRef = useRef<(() => void) | null>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive, requestPaintRef)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    type P = { x: number, y: number }
    let particles: P[] = []
    let W = 0
    let H = 0

    const init = (w: number, h: number) => {
      W = w
      H = h
      particles = Array.from({ length: FLOW_PARTICLE_COUNT }).map((_, i) => ({
        x: seededUnit(i, 71) * w,
        y: seededUnit(i, 83) * h,
      }))
    }

    const paint = (runtime: CanvasRuntime) => {
      const dims = runtime.size
      ctx.clearRect(0, 0, dims.W, dims.H)

      if (W !== dims.W || H !== dims.H) {
        init(dims.W, dims.H)
      }

      const [cr, cg, cb] = runtime.color

      for (const p of particles) {
        const angle = Math.sin(p.x * 0.018) + Math.sin(p.y * 0.014)
        let x = p.x + Math.cos(angle) * 8
        let y = p.y + Math.sin(angle) * 8

        if (interactive) {
          const mx = mouseRef.current.x
          const my = mouseRef.current.y
          const pdx = p.x - mx
          const pdy = p.y - my
          const pdist = Math.sqrt(pdx * pdx + pdy * pdy)
          const influence = Math.max(0, 1 - pdist / 150)
          x += (pdx / (pdist + 0.001)) * influence * 8
          y += (pdy / (pdist + 0.001)) * influence * 8
        }

        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.4)`
        ctx.beginPath()
        ctx.arc(x, y, 2.0, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const runtime = createCanvasRuntime(canvas, ctx, paint)
    requestPaintRef.current = runtime.requestPaint
    return () => {
      requestPaintRef.current = null
      runtime.cleanup()
    }
  }, [interactive, mouseRef, requestPaintRef])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

// ── 3. GridWave ────────────────────────────────────────────────────────────────
// Dots on a regular grid whose brightness and size follow a fixed diagonal wave.
// Creates a field-of-wheat effect — every column is slightly phase-shifted.

const GRIDWAVE_SPACING = 22
const GRIDWAVE_MAX_R = 3.8

export function GridWave({ className, interactive = false }: { className?: string; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const requestPaintRef = useRef<(() => void) | null>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive, requestPaintRef)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    const paint = (runtime: CanvasRuntime) => {
      const { W, H } = runtime.size
      ctx.clearRect(0, 0, W, H)
      const [cr, cg, cb] = runtime.color
      const phase = 1.1

      const cols = Math.ceil(W / GRIDWAVE_SPACING) + 1
      const rows = Math.ceil(H / GRIDWAVE_SPACING) + 1

      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const x = col * GRIDWAVE_SPACING
          const y = row * GRIDWAVE_SPACING

          // Mouse proximity boosts local wave amplitude (like touching water)
          let boost = 0
          if (interactive) {
            const mdx = (x - mouseRef.current.x) / 140
            const mdy = (y - mouseRef.current.y) / 140
            boost = Math.max(0, 1 - Math.sqrt(mdx * mdx + mdy * mdy))
          }

          const wave = Math.sin(col * 0.5 - row * 0.3 + phase + boost * 2.5)
          const r = 0.5 + GRIDWAVE_MAX_R * (wave * 0.5 + 0.5)
          const alpha = 0.06 + (0.28 + boost * 0.15) * (wave * 0.5 + 0.5)
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
          ctx.beginPath()
          ctx.arc(x, y, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    const runtime = createCanvasRuntime(canvas, ctx, paint)
    requestPaintRef.current = runtime.requestPaint
    return () => {
      requestPaintRef.current = null
      runtime.cleanup()
    }
  }, [interactive, mouseRef, requestPaintRef])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

// ── 4. SineRipple ──────────────────────────────────────────────────────────────
// Concentric phase-offset rings drawn from the center or pointer.

const RIPPLE_RING_COUNT = 7
const RIPPLE_SPACING = 40

export function SineRipple({ className, interactive = false }: { className?: string; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const requestPaintRef = useRef<(() => void) | null>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive, requestPaintRef)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    const paint = (runtime: CanvasRuntime) => {
      const { W, H } = runtime.size
      ctx.clearRect(0, 0, W, H)
      const [cr, cg, cb] = runtime.color
      const phase = 0.45

      // Mouse-driven origin with smooth fallback to center
      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      const hasMouse = interactive && mx > -9998
      const cx = hasMouse ? mx : W / 2
      const cy = hasMouse ? my : H / 2
      const maxR = Math.sqrt(W * W + H * H) / 2

      for (let i = 0; i < RIPPLE_RING_COUNT; i++) {
        const r = (phase * 28 + i * RIPPLE_SPACING) % maxR
        const progress = r / maxR
        const alpha = (1 - progress) * 0.26 * Math.sin(phase * 1.5 + i * 0.8)
        if (alpha <= 0) {
          continue
        }
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    const runtime = createCanvasRuntime(canvas, ctx, paint)
    requestPaintRef.current = runtime.requestPaint
    return () => {
      requestPaintRef.current = null
      runtime.cleanup()
    }
  }, [interactive, mouseRef, requestPaintRef])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

// ── 5. RainDots ────────────────────────────────────────────────────────────────
// Evenly-spaced columns of dots with a fading 2-step tail.
// Subtle and organic — not Matrix-like.

const RAIN_COL_SPACING = 14
const DITHERED_DECORATION_WIDTH = 4096

export function RainDots({ className }: { className?: string }) {
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

    type Drop = { x: number, y: number, alpha: number }
    let drops: Drop[] = []
    let W = 0
    let H = 0

    const init = (w: number, h: number) => {
      W = w
      H = h
      const cols = Math.floor(w / RAIN_COL_SPACING)
      drops = Array.from({ length: cols }).map((_, i) => ({
        x: i * RAIN_COL_SPACING + RAIN_COL_SPACING / 2 + (seededUnit(i, 11) - 0.5) * 6,
        y: seededUnit(i, 17) * h,
        alpha: 0.18 + seededUnit(i, 29) * 0.28,
      }))
    }

    const paint = (runtime: CanvasRuntime) => {
      const { W: currentW, H: currentH } = runtime.size
      if (W !== currentW || H !== currentH) {
        init(currentW, currentH)
      }
      ctx.clearRect(0, 0, currentW, currentH)
      const [cr, cg, cb] = runtime.color

      for (const d of drops) {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${d.alpha.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(d.x, d.y, 2.8, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(d.alpha * 0.3).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(d.x, d.y - 12, 1.8, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(d.alpha * 0.1).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(d.x, d.y - 24, 1.1, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const runtime = createCanvasRuntime(canvas, ctx, paint)
    return () => {
      runtime.cleanup()
    }
  }, [canvasRef])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block size-full" />
    </div>
  )
}

// ── 6. ConnectionMesh ──────────────────────────────────────────────────────────
// Stable nodes connected by faint nearby lines. Mouse attraction is applied as a
// transient draw-time offset instead of mutating the node field.

const MESH_NODE_COUNT = 55
const MESH_CONNECT_DIST = 100
const MESH_INFLUENCE_DIST = 150

export function ConnectionMesh({ className, interactive = true }: { className?: string; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const requestPaintRef = useRef<(() => void) | null>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive, requestPaintRef)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    type Node = { x: number; y: number }
    let nodes: Node[] = []
    let W = 0
    let H = 0

    const init = (w: number, h: number) => {
      W = w; H = h
      nodes = Array.from({ length: MESH_NODE_COUNT }, (_, i) => ({
        x: seededUnit(i, 41) * w,
        y: seededUnit(i, 53) * h,
      }))
    }

    const getDisplayNode = (node: Node): Node => {
      if (!interactive) {
        return node
      }
      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      const dx = mx - node.x
      const dy = my - node.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist >= MESH_INFLUENCE_DIST) {
        return node
      }
      const offset = (1 - dist / MESH_INFLUENCE_DIST) * 18
      return {
        x: node.x + (dx / (dist + 0.001)) * offset,
        y: node.y + (dy / (dist + 0.001)) * offset,
      }
    }

    const paint = (runtime: CanvasRuntime) => {
      const dims = runtime.size
      ctx.clearRect(0, 0, dims.W, dims.H)
      if (W !== dims.W || H !== dims.H) init(dims.W, dims.H)

      const [cr, cg, cb] = runtime.color
      const displayNodes = nodes.map(getDisplayNode)

      // Draw connections
      for (let i = 0; i < displayNodes.length; i++) {
        for (let j = i + 1; j < displayNodes.length; j++) {
          const dx = displayNodes[i].x - displayNodes[j].x
          const dy = displayNodes[i].y - displayNodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MESH_CONNECT_DIST) {
            const alpha = (1 - dist / MESH_CONNECT_DIST) * 0.1
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
            ctx.lineWidth = 0.5
            ctx.beginPath()
            ctx.moveTo(displayNodes[i].x, displayNodes[i].y)
            ctx.lineTo(displayNodes[j].x, displayNodes[j].y)
            ctx.stroke()
          }
        }
      }

      // Draw nodes
      for (const n of displayNodes) {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.25)`
        ctx.beginPath()
        ctx.arc(n.x, n.y, 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const runtime = createCanvasRuntime(canvas, ctx, paint)
    requestPaintRef.current = runtime.requestPaint
    return () => {
      requestPaintRef.current = null
      runtime.cleanup()
    }
  }, [interactive, mouseRef, requestPaintRef])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

// ── 7. SpotlightGradient ───────────────────────────────────────────────────────
// A soft radial glow that follows the cursor — the simplest possible mouse
// decoration. Renders a single large gradient at ~6% opacity.

export function SpotlightGradient({ className, interactive = true, radius = 300 }: { className?: string; interactive?: boolean; radius?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const requestPaintRef = useRef<(() => void) | null>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive, requestPaintRef)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const paint = (runtime: CanvasRuntime) => {
      const { W, H } = runtime.size
      ctx.clearRect(0, 0, W, H)
      const [cr, cg, cb] = runtime.color

      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      if (mx > -9998) {
        const gradient = ctx.createRadialGradient(mx, my, 0, mx, my, radius)
        gradient.addColorStop(0, `rgba(${cr},${cg},${cb},0.06)`)
        gradient.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.03)`)
        gradient.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, W, H)
      }
    }

    const runtime = createCanvasRuntime(canvas, ctx, paint)
    requestPaintRef.current = runtime.requestPaint
    return () => {
      requestPaintRef.current = null
      runtime.cleanup()
    }
  }, [interactive, mouseRef, radius, requestPaintRef])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

interface DitheredGradientDecorationProps {
  /** Number of rows. @default 16 */
  rows?: number
  /** Cell size in px. @default 10 */
  cellSize?: number
  /** Gap between cells in px. @default 3 */
  gap?: number
  /** Border radius of cells in px. @default 2 */
  radius?: number
  /** Mouse glow radius in px. @default 100 */
  glowRadius?: number
  /** Fraction of cells that are visible (0-1). @default 0.6 */
  density?: number
  /** Whether to fade out at the bottom. @default true */
  fadeBottom?: boolean
  /** Track mouse via window listener instead of canvas-only events.
   *  Use when the canvas is a top decoration and content overlaps it. @default false */
  trackGlobal?: boolean
  /** Whether the decoration animation should run. @default true */
  active?: boolean
  /** Visual tone. @default 'neutral' */
  tone?: 'neutral' | 'plan'
  className?: string
  style?: React.CSSProperties
}

function getDitheredCellFillStyle(lightness: number, tone: 'neutral' | 'plan'): string {
  if (tone === 'plan') {
    return `oklch(${lightness.toFixed(3)} 0.135 72)`
  }
  return `oklch(${lightness.toFixed(3)} 0 0)`
}

function clearDitheredMouseTarget(target: { current: { x: number, y: number } }): boolean {
  if (target.current.x <= -9998) {
    return false
  }
  target.current = { x: -9999, y: -9999 }
  return true
}

function updateDitheredMouseTarget(
  canvas: HTMLCanvasElement | null,
  target: { current: { x: number, y: number } },
  glowRadius: number,
  clientX: number,
  clientY: number,
): boolean {
  const rect = canvas?.getBoundingClientRect()
  if (!rect) {
    return false
  }

  const x = clientX - rect.left
  const y = clientY - rect.top
  const inGlowRange = glowRadius > 0
    && x >= -glowRadius
    && x <= rect.width + glowRadius
    && y >= -glowRadius
    && y <= rect.height + glowRadius

  if (!inGlowRange) {
    return clearDitheredMouseTarget(target)
  }

  const current = target.current
  if (Math.abs(current.x - x) < 0.5 && Math.abs(current.y - y) < 0.5) {
    return false
  }

  target.current = { x, y }
  return true
}

/**
 * GitHub-style contribution graph decoration — Canvas-based, monochrome dither
 * pattern with deterministic brightness variation. Mouse proximity creates a
 * localized glow. Pattern is position-stable: resizing the window does not
 * reshuffle the layout.
 */
export function DitheredGradientDecoration({
  rows = 16,
  cellSize = 10,
  gap = 3,
  radius = 2,
  glowRadius = 100,
  density = 0.6,
  fadeBottom = true,
  trackGlobal = false,
  active = true,
  tone = 'neutral',
  className,
  style,
}: DitheredGradientDecorationProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const targetMouseRef = useRef({ x: -9999, y: -9999 })
  const requestPaintRef = useRef<(() => void) | null>(null)
  const toneRef = useRef(tone)

  const step = cellSize + gap

  useEffect(() => {
    toneRef.current = tone
    requestPaintRef.current?.()
  }, [tone])

  useEffect(() => {
    if (!active) {
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Position-based hash: same (col, row) always produces the same value.
    // This keeps the pattern stable across window / container resizes.
    function posHash(col: number, row: number): number {
      const x = Math.sin(col * 127.1 + row * 311.7) * 43758.5453
      return x - Math.floor(x)
    }

    const invThreshold = 1 - density
    const t1 = invThreshold + density * (1 / 3)
    const t2 = invThreshold + density * (2 / 3)
    const t3 = invThreshold + density * 0.867

    const baseLightness = {
      dark: [0, 0.65, 0.50, 0.38, 0.25],
      light: [0, 0.86, 0.72, 0.58, 0.44],
    } as const

    let cellColumns = -1
    let cells: Array<{
      x: number
      y: number
      cx: number
      cy: number
      darkLightness: number
      lightLightness: number
    }> = []

    const rebuildCells = (cols: number) => {
      cellColumns = cols
      cells = []
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const v = posHash(col, row)
          let level = 0
          if (v >= invThreshold && v < t1) level = 1
          else if (v >= t1 && v < t2) level = 2
          else if (v >= t2 && v < t3) level = 3
          else if (v >= t3) level = 4

          if (level === 0) {
            continue
          }

          const direction = posHash(col * 3 + 7, row * 3 + 7) > 0.5 ? 1 : -1
          const blend = posHash(col * 5 + 13, row * 5 + 13)
          const targetLevel = Math.max(1, Math.min(4, level + direction))
          cells.push({
            x: col * step,
            y: row * step,
            cx: col * step + cellSize / 2,
            cy: row * step + cellSize / 2,
            darkLightness: baseLightness.dark[level] + (baseLightness.dark[targetLevel] - baseLightness.dark[level]) * blend,
            lightLightness: baseLightness.light[level] + (baseLightness.light[targetLevel] - baseLightness.light[level]) * blend,
          })
        }
      }
    }

    const paint = (runtime: CanvasRuntime) => {
      const { W: w, H: h } = runtime.size
      ctx.clearRect(0, 0, w, h)

      const cols = Math.ceil(w / step)
      if (cols !== cellColumns) {
        rebuildCells(cols)
      }

      const isDark = runtime.theme === 'dark'
      const mouse = targetMouseRef.current
      const hasMouse = mouse.x > -9998 && glowRadius > 0
      const glowRadiusSquared = glowRadius * glowRadius
      const tone = toneRef.current

      for (const cell of cells) {
        let finalL = isDark ? cell.darkLightness : cell.lightLightness
        if (hasMouse) {
          const dx = mouse.x - cell.cx
          const dy = mouse.y - cell.cy
          const distanceSquared = dx * dx + dy * dy
          if (distanceSquared < glowRadiusSquared) {
            const glow = Math.max(0, 1 - Math.sqrt(distanceSquared) / glowRadius) ** 1.5
            finalL = isDark
              ? Math.min(0.95, finalL + glow * 0.35)
              : Math.max(0.05, finalL - glow * 0.35)
          }
        }

        ctx.fillStyle = getDitheredCellFillStyle(finalL, tone)
        ctx.beginPath()
        ctx.roundRect(cell.x, cell.y, cellSize, cellSize, radius)
        ctx.fill()
      }

      if (fadeBottom) {
        const grad = ctx.createLinearGradient(0, 0, 0, h)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(0.3, 'rgba(255,255,255,0)')
        grad.addColorStop(1, 'rgba(255,255,255,1)')
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'source-over'
      }
    }

    const runtime = createCanvasRuntime(canvas, ctx, paint)
    requestPaintRef.current = runtime.requestPaint

    let cleanupMouse: (() => void) | undefined
    if (trackGlobal) {
      const onMove = (e: MouseEvent) => {
        if (updateDitheredMouseTarget(canvas, targetMouseRef, glowRadius, e.clientX, e.clientY)) {
          runtime.requestPaint()
        }
      }
      const onLeave = () => {
        if (clearDitheredMouseTarget(targetMouseRef)) {
          runtime.requestPaint()
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('blur', onLeave)
      cleanupMouse = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('blur', onLeave)
      }
    }

    return () => {
      requestPaintRef.current = null
      runtime.cleanup()
      cleanupMouse?.()
    }
  }, [active, rows, cellSize, radius, glowRadius, density, fadeBottom, step, trackGlobal])

  const handleMouseMove = (e: { clientX: number, clientY: number }) => {
    if (updateDitheredMouseTarget(canvasRef.current, targetMouseRef, glowRadius, e.clientX, e.clientY)) {
      requestPaintRef.current?.()
    }
  }

  const handleMouseLeave = () => {
    if (clearDitheredMouseTarget(targetMouseRef)) {
      requestPaintRef.current?.()
    }
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn(trackGlobal ? 'pointer-events-none' : 'pointer-events-auto', 'absolute left-1/2 top-0 -translate-x-1/2', className)}
      style={{ ...style, height: rows * step + gap, width: DITHERED_DECORATION_WIDTH, maxWidth: 'none' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  )
}
