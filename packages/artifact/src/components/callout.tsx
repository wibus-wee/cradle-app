import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface CalloutProps {
  title?: string
  children?: ReactNode
  tone?: 'info' | 'success' | 'warning' | 'danger'
  className?: string
}

const TONE_CLASSES: Record<NonNullable<CalloutProps['tone']>, string> = {
  info: 'border-blue-500/30 bg-blue-500/5 text-foreground',
  success: 'border-emerald-500/30 bg-emerald-500/5 text-foreground',
  warning: 'border-amber-500/30 bg-amber-500/5 text-foreground',
  danger: 'border-rose-500/30 bg-rose-500/5 text-foreground',
}

export function Callout({ title, children, tone = 'info', className }: CalloutProps) {
  return (
    <div className={cn('rounded-md border px-3 py-2.5 text-[12px] leading-5', TONE_CLASSES[tone], className)}>
      {title
        ? <div className="mb-1 text-[13px] font-medium">{title}</div>
        : null}
      <div className="text-text-secondary">{children}</div>
    </div>
  )
}
