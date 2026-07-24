import { CloseLine as CancelIcon, DownloadLine as DownloadIcon } from '@mingcute/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/cn'
import { formatCompactBytes } from '~/lib/number-format'
import { openResources, openSettingsSection } from '~/navigation/navigation-commands'

import { downloadErrorKey, downloadStatusKey, retryDestination } from './presentation'
import type { DownloadTask } from './types'
import { isActiveDownload } from './types'
import { useDownloadCenter, useDownloadCenterCancel } from './use-download-center'

const SCOPE_KEY = {
  desktop: 'download.scope.desktop',
  server: 'download.scope.server',
} as const

function taskProgress(task: DownloadTask): string {
  if (task.totalBytes === null || task.totalBytes <= 0) { return formatCompactBytes(task.transferredBytes) }
  return `${formatCompactBytes(task.transferredBytes)} / ${formatCompactBytes(task.totalBytes)}`
}

export const DownloadTaskRow = memo(({ task, showFileName = false }: { task: DownloadTask, showFileName?: boolean }) => {
  const { t } = useTranslation('chrome')
  const cancel = useDownloadCenterCancel()
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
{' '}
·
{' '}
            {t(SCOPE_KEY[task.scope])}
{' '}
·
{' '}
            {t(downloadStatusKey(task))}
          </p>
        </div>
        {active && (
          <Button type="button" variant="ghost" size="icon-sm" className="size-10 shrink-0 active:scale-[0.96]" aria-label={t('download.action.cancel')} onClick={() => void cancel(task)}>
            <CancelIcon className="size-3.5" />
          </Button>
        )}
      </div>
      {active && (
        <div className="mt-1.5">
          <div className="h-1 overflow-hidden rounded-full bg-background/80" role="progressbar" aria-label={t('download.status.downloading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
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
          onClick={() => retryTarget === 'resources' ? openResources() : openSettingsSection(retryTarget)}
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
})

export function DownloadCenterChrome({ className }: { className?: string }) {
  const { t } = useTranslation('chrome')
  const { active, recent } = useDownloadCenter()
  const progress = active.reduce((total, task) => total + task.transferredBytes, 0)
  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Button type="button" variant="ghost" size="icon-xs" className={cn('relative size-10 active:scale-[0.96]', className)} aria-label={t('download.title')}>
            <DownloadIcon className="size-4" />
            {active.length > 0 && <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium tabular-nums text-primary-foreground">{active.length}</span>}
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-80 gap-2 p-2.5" data-testid="download-center-popover">
        <div className="flex items-baseline justify-between gap-3 px-0.5">
          <span className="text-[13px] font-medium">{t('download.title')}</span>
          {active.length > 0 && <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{formatCompactBytes(progress)}</span>}
        </div>
        {active.length === 0 && recent.length === 0 && <p className="px-0.5 text-[12px] text-muted-foreground">{t('download.empty')}</p>}
        {active.length > 0 && <div className="space-y-1.5">{active.map(task => <DownloadTaskRow key={`${task.scope}:${task.taskId}`} task={task} />)}</div>}
        {recent.length > 0 && (
<div className="space-y-1.5">
<p className="px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('download.recent')}</p>
{recent.slice(0, 5).map(task => <DownloadTaskRow key={`${task.scope}:${task.taskId}`} task={task} />)}
</div>
)}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-0.5 w-full justify-center transition-transform active:scale-[0.96]"
          onClick={() => openResources()}
        >
          {t('download.action.viewAll')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
