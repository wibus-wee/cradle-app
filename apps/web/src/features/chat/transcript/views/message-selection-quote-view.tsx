import { QuoteLeftLine as QuoteIcon } from '@mingcute/react'
import { m, useReducedMotion } from 'motion/react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

export interface MessageSelectionQuoteViewProps {
  top: number
  left: number
  label: string
  onQuote: () => void
}

/**
 * Props-only floating selection toolbar for a selected message range.
 *
 * The toolbar surface owns the opaque background (inline `var(--card)`), so
 * the action inside can stay a transparent ghost Button without letting the
 * page content shine through.
 */
export function MessageSelectionQuoteView({
  top,
  left,
  label,
  onQuote,
}: MessageSelectionQuoteViewProps) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <m.div
      data-testid="message-selection-quote"
      role="toolbar"
      aria-label={label}
      initial={shouldReduceMotion ? false : { opacity: 0, y: 4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 2, scale: 0.98 }}
      transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', duration: 0.2, bounce: 0 }}
      style={{ top, left, backgroundColor: 'var(--card)' }}
      className={cn(
        'pointer-events-auto fixed z-50 flex items-stretch',
        'overflow-hidden rounded-md border border-border',
        'shadow-[0_8px_24px_-6px_color-mix(in_srgb,var(--foreground)_28%,transparent),0_2px_6px_color-mix(in_srgb,var(--foreground)_14%,transparent)]',
        'dark:shadow-[0_8px_24px_-6px_rgb(0_0_0/0.55),0_2px_6px_rgb(0_0_0/0.35)]',
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={label}
        title={label}
        onPointerDown={event => event.preventDefault()}
        onClick={onQuote}
        className={cn(
          'h-7 gap-1 rounded-none px-2 text-[11px] font-medium text-foreground',
          'hover:bg-muted hover:text-foreground',
        )}
      >
        <QuoteIcon className="size-3" aria-hidden="true" />
        {label}
      </Button>
    </m.div>
  )
}
