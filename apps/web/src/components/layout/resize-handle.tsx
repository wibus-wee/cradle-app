import { useState } from 'react'

import { cn } from '~/lib/cn'

type ResizeValue = number | (() => number)

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  /** Current panel size value */
  value: ResizeValue
  /** Called with the new clamped value on every pointer move */
  onChange: (v: number) => void
  /** Called once with the final clamped value when the drag commits. */
  onChangeEnd?: (v: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  min?: ResizeValue
  max?: ResizeValue
  /**
   * Negate the drag delta.
   * Use for right-anchored panels (dragging left ↑ width) and
   * bottom-anchored panels (dragging up ↑ height).
   */
  inverted?: boolean
  className?: string
}

function readResizeValue(value: ResizeValue): number {
  return typeof value === 'function' ? value() : value
}

export const ResizeHandle = ({
  direction,
  value,
  onChange,
  onChangeEnd,
  onDragStart,
  onDragEnd,
  min = 0,
  max = Infinity,
  inverted = false,
  className,
}: ResizeHandleProps) => {
  const [active, setActive] = useState(false)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActive(true)
    onDragStart?.()

    const axis = direction === 'horizontal' ? 'clientX' : 'clientY'
    const start = e[axis]
    const startVal = readResizeValue(value)
    let latestValue = startVal

    const onMove = (me: PointerEvent) => {
      const delta = (me[axis] - start) * (inverted ? -1 : 1)
      latestValue = Math.max(readResizeValue(min), Math.min(readResizeValue(max), startVal + delta))
      onChange(latestValue)
    }

    const onUp = () => {
      setActive(false)
      onChangeEnd?.(latestValue)
      onDragEnd?.()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const isH = direction === 'horizontal'

  return (
    <div
      onPointerDown={handlePointerDown}
      className={cn(
        'group relative shrink-0 select-none touch-none z-10',
        'w-auto h-auto',
        className,
      )}
    >
      {/* Invisible hit area — only a hairline appears on hover / drag */}
      <div
        className={cn(
          'absolute rounded-full transition-[background-color,opacity,transform] duration-300',
          isH ? 'w-1.25 h-full cursor-col-resize' : 'h-1.25 w-full cursor-row-resize',
          // active ? 'bg-border/40' : 'bg-transparent group-hover:bg-border/20',
          // use border
          active ? 'border-border/40' : 'border-transparent group-hover:border-border/20',
        )}
      />
    </div>
  )
}
ResizeHandle.displayName = 'ResizeHandle'
