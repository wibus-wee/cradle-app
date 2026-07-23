import { cn } from '~/lib/cn'

import type { AutomationRunStatus } from './types'

const STATUS_DOT_COLORS: Record<AutomationRunStatus, string> = {
  queued: 'bg-sky-400',
  running: 'bg-amber-400',
  complete: 'bg-emerald-400',
  failed: 'bg-red-400',
  cancelled: 'bg-muted-foreground/40',
  skipped: 'bg-muted-foreground/40',
}

export interface AutomationStatusDotProps {
  status: string | null | undefined
  className?: string
}

export function AutomationStatusDot({
  status,
  className,
}: AutomationStatusDotProps) {
  const normalized = (status ?? 'queued') as AutomationRunStatus
  return (
    <span
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        STATUS_DOT_COLORS[normalized] ?? STATUS_DOT_COLORS.queued,
        className,
      )}
    />
  )
}
