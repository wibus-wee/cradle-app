import { CloseLine as CancelIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { formatCompactBytes } from '~/lib/number-format'

import { downloadErrorKey, downloadStatusKey, retryDestination } from './presentation'
import type { DownloadTask } from './types'
import { isActiveDownload } from './types'

const SCOPE_KEY = {
  desktop: 'download.scope.desktop',
  server: 'download.scope.server',
} as const

export interface DownloadTaskRowViewProps {
  task: DownloadTask
  showFileName?: boolean
  onCancel: (task: DownloadTask) => void
  onRetry: (task: DownloadTask) => void
}

function taskProgress(task: DownloadTask): string {
  if (task.totalBytes === null || task.totalBytes <= 0) {
    return formatCompactBytes(task.transferredBytes)
  }
  return `${formatCompactBytes(task.transferredBytes)} / ${formatCompactBytes(task.totalBytes)}`
}

export function DownloadTaskRowView({
  task,
  showFileName = false,
  onCancel,
  onRetry,
}: DownloadTaskRowViewProps) {
  const { t } = useTranslation('chrome')
  const active = isActiveDownload(task)
  const retryTarget = retryDestination(task)
  const percent = task.totalBytes && task.totalBytes > 0
    ? Math.min(100, Math.round((task.transferredBytes / task.totalBytes) * 100))
    : null

  return (
    <div className="rounded-md bg-muted/45 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium text-foreground">{task.owner.displayName || task.fileName}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {showFileName ? `${task.fileName} · ` : ''}
            {task.owner.namespace}
            {' · '}
            {t(SCOPE_KEY[task.scope])}
            {' · '}
            {t(downloadStatusKey(task))}
          </p>
        </div>
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-10 shrink-0 active:scale-[0.96]"
            aria-label={t('download.action.cancel')}
            onClick={() => onCancel(task)}
          >
            <CancelIcon className="size-3.5" />
          </Button>
        )}
      </div>

      {active && (
        <div className="mt-1.5">
          <div
            className="h-1 overflow-hidden rounded-full bg-background/80"
            role="progressbar"
            aria-label={t('download.status.downloading')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <div
              className={cn('h-full rounded-full bg-primary', percent === null && 'w-1/3')}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
            {taskProgress(task)}
            {percent === null ? ' · —' : ` · ${percent}%`}
          </p>
        </div>
      )}

      {task.status === 'failed' && retryTarget && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="mt-1.5 active:scale-[0.96]"
          onClick={() => onRetry(task)}
        >
          {t('download.action.openOwnerRetry')}
        </Button>
      )}

      {task.status === 'failed' && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {t('download.error.last')}
          {' '}
          {t(downloadErrorKey(task))}
        </p>
      )}
    </div>
  )
}
