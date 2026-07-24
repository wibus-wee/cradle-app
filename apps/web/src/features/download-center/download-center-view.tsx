import { DownloadLine as DownloadIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/cn'
import { formatCompactBytes } from '~/lib/number-format'

import { DownloadTaskRowView } from './download-task-row-view'
import type { DownloadTask } from './types'

export interface DownloadCenterViewProps {
  active: readonly DownloadTask[]
  recent: readonly DownloadTask[]
  onCancel: (task: DownloadTask) => void
  onRetry: (task: DownloadTask) => void
  onViewAll: () => void
  className?: string
  defaultOpen?: boolean
}

export function DownloadCenterView({
  active,
  recent,
  onCancel,
  onRetry,
  onViewAll,
  className,
  defaultOpen,
}: DownloadCenterViewProps) {
  const { t } = useTranslation('chrome')
  const progress = active.reduce((total, task) => total + task.transferredBytes, 0)

  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn('relative size-10 active:scale-[0.96]', className)}
            aria-label={t('download.title')}
          >
            <DownloadIcon className="size-4" />
            {active.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium tabular-nums text-primary-foreground">
                {active.length}
              </span>
            )}
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-80 gap-2 p-2.5" data-testid="download-center-popover">
        <div className="flex items-baseline justify-between gap-3 px-0.5">
          <span className="text-[13px] font-medium">{t('download.title')}</span>
          {active.length > 0 && (
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatCompactBytes(progress)}
            </span>
          )}
        </div>

        {active.length === 0 && recent.length === 0 && (
          <p className="px-0.5 text-[12px] text-muted-foreground">{t('download.empty')}</p>
        )}

        {active.length > 0 && (
          <div className="space-y-1.5">
            {active.map(task => (
              <DownloadTaskRowView
                key={`${task.scope}:${task.taskId}`}
                task={task}
                onCancel={onCancel}
                onRetry={onRetry}
              />
            ))}
          </div>
        )}

        {recent.length > 0 && (
          <div className="space-y-1.5">
            <p className="px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('download.recent')}
            </p>
            {recent.slice(0, 5).map(task => (
              <DownloadTaskRowView
                key={`${task.scope}:${task.taskId}`}
                task={task}
                onCancel={onCancel}
                onRetry={onRetry}
              />
            ))}
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-0.5 w-full justify-center transition-transform active:scale-[0.96]"
          onClick={onViewAll}
        >
          {t('download.action.viewAll')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
