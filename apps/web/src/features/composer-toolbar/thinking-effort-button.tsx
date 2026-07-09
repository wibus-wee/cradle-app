import type { Transition } from 'motion/react'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { useRef, useState } from 'react'

import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'
import { cn } from '~/lib/cn'

import type { ThinkingOption } from './provider-model-menu'
import type { ThinkingEffort } from './types'

type ConcreteEffort = NonNullable<ThinkingEffort>
type Mode = 'idle' | 'dragging'

const LONG_PRESS_MS = 180
const DRAG_START_THRESHOLD_PX = 8
const SEGMENT_WIDTH = 20
const STRIP_PADDING_X = 2
const DEPTH_BAR_HEIGHTS = [5, 7, 9, 11]

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index))
}

export function ThinkingEffortButton({
  thinkingEffort,
  thinkingOptions = [],
  onSelect,
  occludeNativeBrowserSurface,
}: {
  thinkingEffort: ThinkingEffort
  thinkingOptions: Array<ThinkingOption<ThinkingEffort>>
  onSelect: (effort: ThinkingEffort) => void
  occludeNativeBrowserSurface?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const tiers = thinkingOptions.filter((option): option is ThinkingOption<ConcreteEffort> => option.value !== null)

  const selectedIndex = tiers.findIndex(option => option.value === thinkingEffort)
  const currentIndex = selectedIndex === -1 ? 0 : selectedIndex
  const [mode, setMode] = useState<Mode>('idle')
  const [dragIndex, setDragIndex] = useState(currentIndex)
  const activeIndex = mode === 'dragging' ? dragIndex : currentIndex

  const active = tiers[activeIndex] ?? tiers[0]
  const activeLabel = active?.label ?? 'unknown'
  const isDisabled = tiers.length === 0
  const activeDepthBarCount = isDisabled || active?.value === 'none'
    ? 0
    : Math.max(1, Math.round(((activeIndex + 1) / tiers.length) * DEPTH_BAR_HEIGHTS.length))
  const surfaceProps = occludeNativeBrowserSurface ? BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS : {}
  const pointerStartXRef = useRef<number | null>(null)
  const pointerStartIndexRef = useRef(currentIndex)
  const longPressTimerRef = useRef<number | null>(null)
  const movedRef = useRef(false)
  const draggingRef = useRef(false)
  const dragIndexRef = useRef(currentIndex)
  const previousActiveIndexRef = useRef(activeIndex)
  const labelDirection = activeIndex >= previousActiveIndexRef.current ? 1 : -1
  previousActiveIndexRef.current = activeIndex
  const stripWidth = tiers.length * SEGMENT_WIDTH + STRIP_PADDING_X * 2
  const transition: Transition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring', stiffness: 620, damping: 42, mass: 0.58 }
  const labelTransition: Transition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring', stiffness: 560, damping: 36, mass: 0.5 }

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const updateDragPosition = (delta: number) => {
    if (tiers.length === 0) {
      return
    }

    const rawX = pointerStartIndexRef.current * SEGMENT_WIDTH + delta
    const nextIndex = clampIndex(Math.round(rawX / SEGMENT_WIDTH), tiers.length)
    const previousIndex = dragIndexRef.current

    dragIndexRef.current = nextIndex
    if (nextIndex !== previousIndex) {
      setDragIndex(nextIndex)
    }
  }

  const startDragging = (delta = 0) => {
    if (pointerStartXRef.current === null || tiers.length === 0) {
      return
    }

    draggingRef.current = true
    dragIndexRef.current = pointerStartIndexRef.current
    setMode('dragging')
    setDragIndex(pointerStartIndexRef.current)
    updateDragPosition(delta)
  }

  const selectOffset = (offset: number) => {
    if (tiers.length === 0) {
      return
    }
    const nextIndex = (currentIndex + offset + tiers.length) % tiers.length
    onSelect(tiers[nextIndex].value)
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (isDisabled || (event.pointerType === 'mouse' && event.button !== 0)) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    pointerStartXRef.current = event.clientX
    pointerStartIndexRef.current = currentIndex
    movedRef.current = false
    draggingRef.current = false
    dragIndexRef.current = currentIndex
    setDragIndex(currentIndex)
    clearLongPress()
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      if (movedRef.current || pointerStartXRef.current === null) {
        return
      }
      startDragging()
    }, LONG_PRESS_MS)
  }

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerStartXRef.current === null || tiers.length === 0) {
      return
    }

    const delta = event.clientX - pointerStartXRef.current
    if (!draggingRef.current) {
      if (Math.abs(delta) > DRAG_START_THRESHOLD_PX) {
        movedRef.current = true
        clearLongPress()
        startDragging(delta)
      }
      return
    }

    updateDragPosition(delta)
  }

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    catch {
      // Pointer capture may already be released.
    }

    const wasDragging = draggingRef.current
    const wasShortPress = longPressTimerRef.current !== null
    clearLongPress()
    pointerStartXRef.current = null
    draggingRef.current = false

    if (wasDragging) {
      const committed = tiers[dragIndexRef.current] ?? active
      if (committed && committed.value !== thinkingEffort) {
        onSelect(committed.value)
      }
      setMode('idle')
      return
    }

    if (wasShortPress && !movedRef.current) {
      selectOffset(1)
    }
  }

  const handlePointerCancel = () => {
    clearLongPress()
    pointerStartXRef.current = null
    draggingRef.current = false
    dragIndexRef.current = currentIndex
    setMode('idle')
    setDragIndex(currentIndex)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      selectOffset(1)
    }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      selectOffset(-1)
    }
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectOffset(1)
    }
  }

  return (
    <m.button
      {...surfaceProps}
      initial={false}
      animate={{ scale: mode === 'dragging' ? 1.02 : 1 }}
      transition={transition}
      type="button"
      data-testid="composer-thinking-effort-trigger"
      data-thinking-effort={active?.value ?? ''}
      data-mode={mode}
      disabled={isDisabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      aria-label={`Thinking effort: ${activeLabel}. Click to cycle or long-press and drag to adjust.`}
      title={`Thinking effort: ${activeLabel}`}
      className={cn(
        'inline-flex h-6 shrink-0 select-none items-center rounded-[min(var(--radius-md),10px)] px-1.5 text-xs outline-none transition-colors',
        'bg-foreground/[0.055] text-muted-foreground transition-colors',
        'hover:bg-foreground/[0.08] hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-primary/35',
        mode === 'dragging' && 'cursor-grabbing bg-foreground/[0.08] text-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
      style={{ touchAction: 'none' }}
    >
      <span
        aria-hidden="true"
        className="flex size-3.5 shrink-0 items-end justify-center gap-[1.5px] -mt-0.5"
      >
        {DEPTH_BAR_HEIGHTS.map((height, index) => (
          <span
            key={height}
            className={cn(
              'rounded-full transition-colors',
              index < activeDepthBarCount ? 'bg-muted-foreground/55' : 'bg-muted-foreground/12',
              mode === 'dragging' && index < activeDepthBarCount && 'bg-foreground/65',
            )}
            style={{ width: 1.5, height }}
          />
        ))}
      </span>
      <m.span
        aria-hidden="true"
        initial={false}
        className="relative inline-flex h-4 shrink-0 items-center overflow-hidden rounded-[6px] bg-foreground/[0.07] p-0.5"
        animate={{
          opacity: mode === 'dragging' ? 1 : 0,
          width: mode === 'dragging' ? stripWidth : 0,
          marginLeft: mode === 'dragging' ? 3 : 0,
          marginRight: mode === 'dragging' ? 3 : 0,
        }}
        transition={transition}
      >
        {!isDisabled && (
          <m.span
            aria-hidden="true"
            initial={false}
            className="absolute top-0.5 bottom-0.5 rounded-[4px] bg-background/65 shadow-[0_1px_1px_rgb(0_0_0_/_0.08)]"
            animate={{ x: activeIndex * SEGMENT_WIDTH, width: SEGMENT_WIDTH }}
            transition={transition}
            style={{ left: STRIP_PADDING_X }}
          />
        )}
        {tiers.map((tier, index) => {
          const isSelected = index === activeIndex
          return (
            <span
              key={tier.value}
              style={{ width: SEGMENT_WIDTH }}
              className={cn(
                'relative z-10 flex h-3 items-center justify-center rounded-[4px] transition-colors',
                index > 0 && 'before:absolute before:left-0 before:top-1/2 before:h-2 before:w-px before:-translate-y-1/2 before:bg-foreground/10',
                isSelected && 'before:bg-transparent',
              )}
            >
              <span
                className={cn(
                  'h-2 w-px rounded-full transition-colors',
                  isSelected ? 'bg-foreground/80' : 'bg-muted-foreground/35',
                )}
              />
            </span>
          )
        })}
      </m.span>
      <span className="relative inline-flex mt-0.5 min-w-[3ch] shrink-0 items-center overflow-hidden whitespace-nowrap text-[11px] font-medium text-muted-foreground/80">
        {mode === 'dragging'
          ? activeLabel
          : (
              <AnimatePresence initial={false} mode="popLayout">
                <m.span
                  key={active?.value ?? 'unknown'}
                  initial={{ opacity: 0, y: labelDirection > 0 ? 8 : -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: labelDirection > 0 ? -8 : 8 }}
                  transition={labelTransition}
                >
                  {activeLabel}
                </m.span>
              </AnimatePresence>
            )}
      </span>
    </m.button>
  )
}
