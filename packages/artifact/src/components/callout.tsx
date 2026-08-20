import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface CalloutProps {
  title?: string
  children?: ReactNode
  tone?: 'info' | 'success' | 'warning' | 'danger'
  className?: string
}

const TONE_CLASSES: Record<NonNullable<CalloutProps['tone']>, string> = {
  info: '[--artifact-tone:var(--color-info)]',
  success: '[--artifact-tone:var(--color-success)]',
  warning: '[--artifact-tone:var(--color-warning)]',
  danger: '[--artifact-tone:var(--color-error)]',
}

export function Callout({ title, children, tone = 'info', className }: CalloutProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] bg-[color-mix(in_srgb,var(--artifact-tone)_10%,transparent)] px-3 py-2.5 text-[12px] leading-5 text-[var(--text-primary)] shadow-[var(--shadow-inset-ring)]',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {title
        ? <div className="mb-1 text-[13px] font-medium">{title}</div>
        : null}
      <div className="text-[var(--text-secondary)]">{children}</div>
    </div>
  )
}
