import type { ReactNode } from 'react'

import { cn } from '~/lib/cn'

/**
 * The small shared vocabulary of the Diffs surface: a status dot, a hairline
 * pill, an added/removed stat pair, and a quiet icon button.
 *
 * Local to Diffs rather than `components/ui` so the reading surface can stay
 * denser than the rest of the app. Colors come from the app token system via
 * the thin `--rv-*` aliases in `review-surface.css`.
 */

export type ReviewStatusTone = 'open' | 'merged' | 'closed' | 'draft' | 'warn' | 'danger' | 'neutral'

const TONE_COLOR: Record<ReviewStatusTone, string> = {
  open: 'text-[var(--rv-open)]',
  merged: 'text-[var(--rv-merged)]',
  closed: 'text-[var(--rv-closed)]',
  draft: 'text-[var(--rv-draft)]',
  warn: 'text-[var(--rv-warn)]',
  danger: 'text-[var(--rv-danger)]',
  neutral: 'text-[var(--rv-fg-muted)]',
}

/**
 * State encoded as form, not just text: a filled ring for live states, a hollow
 * ring for terminal ones, so status reads before the label is parsed.
 */
export function StatusDot({ tone, filled = true, className }: {
  tone: ReviewStatusTone
  filled?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-[7px] shrink-0 rounded-full border-[1.5px] border-current',
        filled && 'bg-current',
        TONE_COLOR[tone],
        className,
      )}
    />
  )
}

/** Hairline label chip. No fill — fills read as buttons at this density. */
export function Pill({ tone = 'neutral', icon, children, className }: {
  tone?: ReviewStatusTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-[var(--rv-radius)] px-2',
        'border border-[var(--rv-line)] bg-[var(--rv-bg-subtle)]',
        'text-[11.5px] font-medium leading-none',
        tone === 'neutral' ? 'text-[var(--rv-fg-muted)]' : TONE_COLOR[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/** `+412 −88`. Always tabular so stats line up down a list. */
export function ChangeStat({ additions, deletions, className }: {
  additions: number
  deletions: number
  className?: string
}) {
  return (
    <span data-rv-num className={cn('inline-flex items-center gap-1.5 text-[11.5px] leading-none', className)}>
      <span className="font-medium text-[var(--rv-add)]">
        +
        {additions}
      </span>
      <span className="font-medium text-[var(--rv-del)]">
        −
        {deletions}
      </span>
    </span>
  )
}

/**
 * A proportional bar for a file's share of additions vs deletions — the same
 * information as the numbers, readable at a glance while scanning a long list.
 */
export function ChangeBar({ additions, deletions, className }: {
  additions: number
  deletions: number
  className?: string
}) {
  const total = additions + deletions
  const addPercent = total === 0 ? 0 : Math.round((additions / total) * 100)
  return (
    <span
      aria-hidden
      className={cn('inline-flex h-[3px] w-9 overflow-hidden rounded-full bg-[var(--rv-bg-inset)]', className)}
    >
      <span className="h-full bg-[var(--rv-add)]" style={{ width: `${addPercent}%` }} />
      <span className="h-full flex-1 bg-[var(--rv-del)]" />
    </span>
  )
}

/** Quiet 28px square action. Chrome appears on hover, never at rest. */
export function IconAction({ label, active, disabled, onClick, children, className }: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--rv-radius)]',
        'text-[var(--rv-fg-muted)] transition-colors duration-100',
        'hover:bg-[var(--rv-bg-hover)] hover:text-[var(--rv-fg)]',
        'disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-[var(--rv-bg-active)] text-[var(--rv-fg)]',
        className,
      )}
    >
      {children}
    </button>
  )
}
