import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface BadgeProps {
  children: ReactNode
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  className?: string
}

const TONE_CLASSES: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  info: 'bg-[color-mix(in_srgb,var(--info)_10%,transparent)] text-[var(--info)]',
  success: 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)]',
  warning: 'bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] text-[var(--warning)]',
  danger: 'bg-[color-mix(in_srgb,var(--error)_10%,transparent)] text-[var(--error)]',
}

/** Compact status chip: 10% tone wash + full-tone text. */
export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium leading-none',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
