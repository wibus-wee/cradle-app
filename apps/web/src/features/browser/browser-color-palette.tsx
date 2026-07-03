// FILE: browser-color-palette.tsx
// Purpose: Animated, full-featured color palette/picker used by the browser annotation inspector swatches.
// Layer: Browser feature UI
// Depends on: ui/popover primitive, motion

import { CheckLine as CheckIcon, ColorPickerLine as PipetteIcon } from '@mingcute/react'
import { m } from 'motion/react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/cn'

// ---------------------------------------------------------------------------
// EyeDropper (not yet in lib.dom typings everywhere)
// ---------------------------------------------------------------------------

interface EyeDropperOpenResult {
  sRGBHex: string
}

interface EyeDropperInstance {
  open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperOpenResult>
}

interface EyeDropperConstructor {
  new (): EyeDropperInstance
}

declare global {
  interface Window {
    EyeDropper?: EyeDropperConstructor
  }
}

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

interface Rgba {
  r: number // 0-255
  g: number // 0-255
  b: number // 0-255
  a: number // 0-1
}

interface Hsva {
  h: number // 0-360
  s: number // 0-1
  v: number // 0-1
  a: number // 0-1
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, precision = 0): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

const RGB_PATTERN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i
const HEX_PATTERN = /^#?([0-9a-f]{3,8})$/i

function parseHex(input: string): Rgba | null {
  const match = input.trim().match(HEX_PATTERN)
  if (!match) {
    return null
  }
  let hex = match[1]
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.split('').map(char => char + char).join('')
  }
  if (hex.length !== 6 && hex.length !== 8) {
    return null
  }
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
  return { r, g, b, a }
}

function parseColor(input: string): Rgba | null {
  const value = input.trim()
  if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  const rgbMatch = value.match(RGB_PATTERN)
  if (rgbMatch) {
    const alphaToken = rgbMatch[4]
    const alpha = alphaToken == null
      ? 1
      : alphaToken.endsWith('%')
        ? clamp(Number.parseFloat(alphaToken) / 100, 0, 1)
        : clamp(Number.parseFloat(alphaToken), 0, 1)
    return {
      r: clamp(Number.parseFloat(rgbMatch[1]), 0, 255),
      g: clamp(Number.parseFloat(rgbMatch[2]), 0, 255),
      b: clamp(Number.parseFloat(rgbMatch[3]), 0, 255),
      a: Number.isFinite(alpha) ? alpha : 1,
    }
  }
  return parseHex(value)
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (channel: number) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function rgbToHsv({ r, g, b, a }: Rgba): Hsva {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === rn) {
      h = ((gn - bn) / delta) % 6
    }
    else if (max === gn) {
      h = (bn - rn) / delta + 2
    }
    else {
      h = (rn - gn) / delta + 4
    }
    h *= 60
    if (h < 0) {
      h += 360
    }
  }

  const s = max === 0 ? 0 : delta / max
  return { h, s, v: max, a }
}

function hsvToRgb({ h, s, v, a }: Hsva): Rgba {
  const chroma = v * s
  const hp = (h % 360) / 60
  const x = chroma * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp >= 0 && hp < 1) {
    [r, g, b] = [chroma, x, 0]
  }
  else if (hp < 2) {
    [r, g, b] = [x, chroma, 0]
  }
  else if (hp < 3) {
    [r, g, b] = [0, chroma, x]
  }
  else if (hp < 4) {
    [r, g, b] = [0, x, chroma]
  }
  else if (hp < 5) {
    [r, g, b] = [x, 0, chroma]
  }
  else {
    [r, g, b] = [chroma, 0, x]
  }
  const matchLightness = v - chroma
  return {
    r: (r + matchLightness) * 255,
    g: (g + matchLightness) * 255,
    b: (b + matchLightness) * 255,
    a,
  }
}

function rgbaEqual(a: Rgba, b: Rgba): boolean {
  return Math.round(a.r) === Math.round(b.r)
    && Math.round(a.g) === Math.round(b.g)
    && Math.round(a.b) === Math.round(b.b)
    && Math.abs(a.a - b.a) < 0.01
}

function formatColor(hsva: Hsva): string {
  const rgba = hsvToRgb(hsva)
  if (hsva.a >= 1) {
    return rgbToHex(rgba.r, rgba.g, rgba.b)
  }
  if (hsva.a <= 0) {
    return 'transparent'
  }
  return `rgba(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(rgba.b)}, ${round(hsva.a, 2)})`
}

function toCssRgb({ r, g, b }: Rgba, alpha: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${round(alpha, 3)})`
}

// ---------------------------------------------------------------------------
// Shared visual constants
// ---------------------------------------------------------------------------

const HUE_GRADIENT
  = 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'

const CHECKERBOARD_STYLE: CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, rgba(120,120,120,0.45) 25%, transparent 25%), linear-gradient(-45deg, rgba(120,120,120,0.45) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(120,120,120,0.45) 75%), linear-gradient(-45deg, transparent 75%, rgba(120,120,120,0.45) 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
}

const PRESET_COLORS = [
  '#000000', '#475569', '#94a3b8', '#ffffff',
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
]

// ---------------------------------------------------------------------------
// Drag surface
// ---------------------------------------------------------------------------

interface DragSurfaceProps {
  className?: string
  style?: CSSProperties
  ariaLabel: string
  ariaValueNow: number
  ariaValueMin?: number
  ariaValueMax?: number
  ariaValueText: string
  onPick: (x: number, y: number) => void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  children?: ReactNode
}

function DragSurface({
  className,
  style,
  ariaLabel,
  ariaValueNow,
  ariaValueMin = 0,
  ariaValueMax = 100,
  ariaValueText,
  onPick,
  onKeyDown,
  children,
}: DragSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null)

  const pick = (clientX: number, clientY: number) => {
    const element = ref.current
    if (!element) {
      return
    }
    const rect = element.getBoundingClientRect()
    const x = clamp((clientX - rect.left) / rect.width, 0, 1)
    const y = clamp((clientY - rect.top) / rect.height, 0, 1)
    onPick(x, y)
  }

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={ariaLabel}
      aria-valuenow={ariaValueNow}
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
      aria-valuetext={ariaValueText}
      tabIndex={0}
      className={cn('relative touch-none outline-none', className)}
      style={style}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        pick(event.clientX, event.clientY)
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 1) {
          return
        }
        pick(event.clientX, event.clientY)
      }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

export interface BrowserColorPaletteProps {
  value: string
  onChange: (value: string) => void
  label?: string
  className?: string
}

export function BrowserColorPalette({ value, onChange, label = 'Color', className }: BrowserColorPaletteProps) {
  const [open, setOpen] = useState(false)
  const [hsva, setHsva] = useState<Hsva>(() => rgbToHsv(parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 }))
  const [controlledValue, setControlledValue] = useState(value)
  const [hexDraft, setHexDraft] = useState(() => {
    const initialRgba = hsvToRgb(rgbToHsv(parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 }))
    return rgbToHex(initialRgba.r, initialRgba.g, initialRgba.b).replace('#', '').toUpperCase()
  })
  const [syncedHexDraft, setSyncedHexDraft] = useState(hexDraft)
  const [supportsEyeDropper] = useState(() => typeof window !== 'undefined' && typeof window.EyeDropper === 'function')
  const eyeDropperAbortRef = useRef<AbortController | null>(null)
  const hexInputId = useId()

  if (value !== controlledValue) {
    setControlledValue(value)
    const parsed = parseColor(value)
    if (parsed && !rgbaEqual(parsed, hsvToRgb(hsva))) {
      setHsva(rgbToHsv(parsed))
    }
  }

  const rgba = hsvToRgb(hsva)
  const opaqueHex = rgbToHex(rgba.r, rgba.g, rgba.b)
  const displayColor = hsva.a <= 0 ? 'transparent' : toCssRgb(rgba, hsva.a)
  const normalizedHexDraft = opaqueHex.replace('#', '').toUpperCase()

  if (normalizedHexDraft !== syncedHexDraft) {
    setSyncedHexDraft(normalizedHexDraft)
    setHexDraft(normalizedHexDraft)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps
    return () => eyeDropperAbortRef.current?.abort()
  }, [])

  const commit = (next: Hsva) => {
    setHsva(next)
    onChange(formatColor(next))
  }

  const handleHexChange = (raw: string) => {
    const sanitized = raw.replace(/[^0-9a-f]/gi, '').slice(0, 8)
    setHexDraft(sanitized.toUpperCase())
    const parsed = parseHex(sanitized)
    if (parsed) {
      commit({ ...rgbToHsv(parsed), a: hsva.a < 1 && parsed.a === 1 ? hsva.a : parsed.a })
    }
  }

  const handleEyeDropper = async () => {
    if (!window.EyeDropper) {
      return
    }
    const controller = new AbortController()
    eyeDropperAbortRef.current = controller
    const releaseController = () => {
      if (eyeDropperAbortRef.current === controller) {
        eyeDropperAbortRef.current = null
      }
    }
    try {
      const dropper = new window.EyeDropper()
      const result = await dropper.open({ signal: controller.signal })
      const parsed = parseHex(result.sRGBHex)
      if (parsed) {
        commit({ ...rgbToHsv(parsed), a: hsva.a })
      }
      releaseController()
    }
    catch {
      // User dismissed the eyedropper — nothing to do.
      releaseController()
    }
  }

  const svKeyStep = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    let handled = true
    let { s, v } = hsva
    switch (event.key) {
      case 'ArrowLeft':
        s = clamp(s - step, 0, 1)
        break
      case 'ArrowRight':
        s = clamp(s + step, 0, 1)
        break
      case 'ArrowUp':
        v = clamp(v + step, 0, 1)
        break
      case 'ArrowDown':
        v = clamp(v - step, 0, 1)
        break
      default:
        handled = false
    }
    if (handled) {
      event.preventDefault()
      commit({ ...hsva, s, v })
    }
  }

  const hueKeyStep = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      commit({ ...hsva, h: (hsva.h - step + 360) % 360 })
    }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      commit({ ...hsva, h: (hsva.h + step) % 360 })
    }
  }

  const alphaKeyStep = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      commit({ ...hsva, a: clamp(hsva.a - step, 0, 1) })
    }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      commit({ ...hsva, a: clamp(hsva.a + step, 0, 1) })
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <m.button
            type="button"
            aria-label={`${label}: ${formatColor(hsva)}`}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', duration: 0.25, bounce: 0.4 }}
            className={cn(
              'relative size-5 shrink-0 overflow-hidden rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.10),0_1px_3px_rgba(0,0,0,0.16)] outline-none ring-primary/55 transition-shadow focus-visible:ring-2 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_1px_3px_rgba(0,0,0,0.28)]',
              className,
            )}
          >
            <span className="absolute inset-0" style={CHECKERBOARD_STYLE} aria-hidden="true" />
            <span className="absolute inset-0" style={{ backgroundColor: displayColor }} aria-hidden="true" />
          </m.button>
        )}
      />
      <PopoverContent align="start" sideOffset={8} className="w-60 gap-0 p-0">
        <div className="flex flex-col gap-3 p-3">
          {/* Saturation / value field */}
          <div>
            <DragSurface
              ariaLabel={`${label} saturation and brightness`}
              ariaValueNow={Math.round(hsva.s * 100)}
              ariaValueText={`Saturation ${Math.round(hsva.s * 100)}%, brightness ${Math.round(hsva.v * 100)}%`}
              className="h-32 w-full cursor-crosshair overflow-hidden rounded-xl ring-1 ring-foreground/10 focus-visible:ring-2 focus-visible:ring-primary/60"
              style={{
                backgroundColor: `hsl(${hsva.h}, 100%, 50%)`,
                backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
              }}
              onKeyDown={svKeyStep}
              onPick={(x, y) => commit({ ...hsva, s: x, v: 1 - y })}
            >
              <span
                className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_1px_4px_rgba(0,0,0,0.4)] transition-transform duration-75"
                style={{
                  left: `${hsva.s * 100}%`,
                  top: `${(1 - hsva.v) * 100}%`,
                  backgroundColor: opaqueHex,
                }}
                aria-hidden="true"
              />
            </DragSurface>
          </div>

          {/* Preview + hue + alpha sliders */}
          <div className="flex items-center gap-2.5">
            <span className="relative size-9 shrink-0 overflow-hidden rounded-full ring-1 ring-foreground/15">
              <span className="absolute inset-0" style={CHECKERBOARD_STYLE} aria-hidden="true" />
              <span className="absolute inset-0" style={{ backgroundColor: displayColor }} aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <DragSurface
                ariaLabel={`${label} hue`}
                ariaValueNow={Math.round(hsva.h)}
                ariaValueMax={360}
                ariaValueText={`Hue ${Math.round(hsva.h)} degrees`}
                className="h-3.5 w-full cursor-pointer rounded-full ring-1 ring-foreground/10 focus-visible:ring-2 focus-visible:ring-primary/60"
                style={{ backgroundImage: HUE_GRADIENT }}
                onKeyDown={hueKeyStep}
                onPick={x => commit({ ...hsva, h: x * 360 })}
              >
                <SliderThumb position={hsva.h / 360} color={`hsl(${hsva.h}, 100%, 50%)`} />
              </DragSurface>
              <DragSurface
                ariaLabel={`${label} opacity`}
                ariaValueNow={Math.round(hsva.a * 100)}
                ariaValueText={`Opacity ${Math.round(hsva.a * 100)}%`}
                className="relative h-3.5 w-full cursor-pointer overflow-hidden rounded-full ring-1 ring-foreground/10 focus-visible:ring-2 focus-visible:ring-primary/60"
                style={CHECKERBOARD_STYLE}
                onKeyDown={alphaKeyStep}
                onPick={x => commit({ ...hsva, a: x })}
              >
                <span
                  className="absolute inset-0 rounded-full"
                  style={{ backgroundImage: `linear-gradient(to right, ${toCssRgb(rgba, 0)}, ${toCssRgb(rgba, 1)})` }}
                  aria-hidden="true"
                />
                <SliderThumb position={hsva.a} color={displayColor} />
              </DragSurface>
            </div>
          </div>

          {/* Hex + alpha inputs + eyedropper */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-lg bg-foreground/5 px-2 ring-1 ring-foreground/10 focus-within:ring-primary/55 dark:bg-white/6">
              <span className="text-[11px] font-medium text-muted-foreground">#</span>
              <Input
                id={hexInputId}
                type="text"
                spellCheck={false}
                value={hexDraft}
                aria-label={`${label} hex value`}
                className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 font-mono text-[11px] uppercase tracking-wide shadow-none focus-visible:ring-0 md:text-[11px]"
                onChange={event => handleHexChange(event.target.value)}
              />
            </div>
            <div className="flex h-8 w-14 items-center gap-0.5 rounded-lg bg-foreground/5 px-2 ring-1 ring-foreground/10 focus-within:ring-primary/55 dark:bg-white/6">
              <Input
                type="number"
                min={0}
                max={100}
                value={Math.round(hsva.a * 100)}
                aria-label={`${label} opacity percent`}
                className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 font-mono text-[11px] tabular-nums shadow-none [appearance:textfield] focus-visible:ring-0 md:text-[11px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                onChange={event => commit({ ...hsva, a: clamp(Number(event.target.value) / 100, 0, 1) })}
              />
              <span className="text-[11px] text-muted-foreground">%</span>
            </div>
            {supportsEyeDropper && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Pick color from screen"
                title="Pick color from screen"
                className="size-8 shrink-0 rounded-lg bg-foreground/5 text-muted-foreground ring-1 ring-foreground/10 hover:bg-foreground/10 hover:text-foreground active:scale-95 dark:bg-white/6"
                onClick={handleEyeDropper}
              >
                <PipetteIcon className="size-3.5" />
              </Button>
            )}
          </div>

          {/* Preset swatches */}
          <div className="grid grid-cols-10 gap-1.5">
            {PRESET_COLORS.map((preset) => {
              const presetRgba = parseHex(preset)
              const selected = presetRgba ? rgbaEqual(presetRgba, { ...rgba, a: 1 }) && hsva.a >= 1 : false
              return (
                <m.button
                  key={preset}
                  type="button"
                  aria-label={`Use color ${preset}`}
                  title={preset}
                  whileHover={{ scale: 1.18, zIndex: 1 }}
                  whileTap={{ scale: 0.88 }}
                  transition={{ type: 'spring', duration: 0.22, bounce: 0.4 }}
                  className="relative flex aspect-square items-center justify-center rounded-md ring-1 ring-foreground/10 ring-inset"
                  style={{ backgroundColor: preset }}
                  onClick={() => presetRgba && commit({ ...rgbToHsv(presetRgba), a: 1 })}
                >
                  {selected && (
                    <CheckIcon
                      className={cn(
                        'size-3 drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]',
                        presetRgba && presetRgba.r + presetRgba.g + presetRgba.b > 420 ? '!text-black' : '!text-white',
                      )}
                    />
                  )}
                </m.button>
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface SliderThumbProps {
  position: number
  color: string
}

function SliderThumb({ position, color }: SliderThumbProps) {
  return (
    <span
      className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_1px_3px_rgba(0,0,0,0.4)] transition-transform duration-75"
      style={{ left: `${clamp(position, 0, 1) * 100}%`, backgroundColor: color }}
      aria-hidden="true"
    />
  )
}
