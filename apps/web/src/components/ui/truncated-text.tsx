import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { useLayoutEffect, useRef, useState } from 'react'

// Inline styles ensure truncation always works regardless of className display conflicts
const clampStyle = (maxLines: number): React.CSSProperties => ({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: maxLines,
  overflow: 'hidden',
})

interface TruncatedTextProps {
  children: string
  maxLines?: number
  className?: string
}

export function TruncatedText({ children, maxLines = 2, className }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [isTruncated, setIsTruncated] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    const check = () => {
      // Skip when element has zero dimensions — happens when it's being unmounted.
      // Without this guard, the final ResizeObserver callback fires with {0,0},
      // incorrectly resetting isTruncated to false and causing a re-render loop.
      if (el.clientHeight === 0 && el.scrollHeight === 0) {
        return
      }
      setIsTruncated(el.scrollHeight > el.clientHeight)
    }
    const ro = new ResizeObserver(check)
    ro.observe(el)
    check()
    return () => ro.disconnect()
  }, [children, maxLines])

  // Non-truncated: ref needed for detection, no tooltip
  if (!isTruncated) {
    return (
      <span ref={ref} style={clampStyle(maxLines)} className={className}>
        {children}
      </span>
    )
  }

  // Truncated: trigger is the clamped span itself, matching the proven asChild pattern
  // title attr acts as fallback in case Radix tooltip has event issues
  return (
    <Tooltip delayDuration={600}>
      <TooltipTrigger asChild>
        <span
          style={clampStyle(maxLines)}
          className={cn(className, 'cursor-default')}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs" side="right">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}
