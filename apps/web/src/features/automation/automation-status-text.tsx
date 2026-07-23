import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import type { AutomationRunStatus } from './types'

const STATUS_TEXT_COLORS: Record<AutomationRunStatus, string> = {
  queued: 'text-sky-500',
  running: 'text-amber-500',
  complete: 'text-emerald-500',
  failed: 'text-red-500',
  cancelled: 'text-muted-foreground',
  skipped: 'text-muted-foreground',
}

export interface AutomationStatusTextProps {
  status: string | null | undefined
}

export function AutomationStatusText({ status }: AutomationStatusTextProps) {
  const { t } = useTranslation('automation')
  const normalized = (status ?? 'queued') as AutomationRunStatus

  return (
    <span
      className={cn(
        'text-[11px]',
        STATUS_TEXT_COLORS[normalized] ?? STATUS_TEXT_COLORS.queued,
      )}
    >
      {t(`status.${status ?? 'unknown'}`, {
        defaultValue: status ?? t('status.unknown'),
      })}
    </span>
  )
}
