import { AlertLine, CheckCircleLine, CloseCircleLine, InformationLine } from '@mingcute/react'
import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface CalloutProps {
  title?: string
  children?: ReactNode
  tone?: 'info' | 'success' | 'warning' | 'danger'
  className?: string
}

const TONE_CLASSES: Record<NonNullable<CalloutProps['tone']>, string> = {
  info: '[--artifact-tone:var(--info)]',
  success: '[--artifact-tone:var(--success)]',
  warning: '[--artifact-tone:var(--warning)]',
  danger: '[--artifact-tone:var(--error)]',
}

const TONE_ICON: Record<NonNullable<CalloutProps['tone']>, ReactNode> = {
  info: <InformationLine className="size-4" />,
  success: <CheckCircleLine className="size-4" />,
  warning: <AlertLine className="size-4" />,
  danger: <CloseCircleLine className="size-4" />,
}

/** Tone wash + line icon; no rings, no dots. */
export function Callout({ title, children, tone = 'info', className }: CalloutProps) {
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-[var(--radius-lg)] bg-[color-mix(in_srgb,var(--artifact-tone)_8%,transparent)] px-3.5 py-3',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span className="mt-px shrink-0 text-[var(--artifact-tone)]" aria-hidden="true">
        {TONE_ICON[tone]}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        {title
          ? <div className="text-[13px] font-medium text-[var(--foreground)]">{title}</div>
          : null}
        <div className="text-xs leading-relaxed text-[var(--muted-foreground)]">{children}</div>
      </div>
    </div>
  )
}
