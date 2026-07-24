import {
  DeleteLine as DeleteIcon,
  DownloadLine as DownloadIcon,
  DriveLine as ModelIcon,
  Refresh1Line as UpdateIcon,
  TerminalBoxLine as RuntimeIcon,
} from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import type { DownloadTask } from '~/features/download-center/types'
import { cn } from '~/lib/cn'
import { formatCompactBytes } from '~/lib/number-format'

import type { ManagedResource } from './projection'
import { managedResourceKey, projectResourceTransferProgress } from './projection'
import type { ManagedResourceAction } from './use-managed-resources'

const STATE_BADGE_CLASS: Record<ManagedResource['state'], string> = {
  'installed': 'bg-success/10 text-success',
  'update-available': 'bg-warning/10 text-warning',
  'installing': 'bg-primary/10 text-primary',
  'not-installed': 'bg-fill text-muted-foreground',
  'error': 'bg-destructive/10 text-destructive',
  'unavailable': 'bg-fill text-muted-foreground/60',
}

export interface ManagedResourceCardViewProps {
  resource: ManagedResource
  tasks: readonly DownloadTask[]
  actionPending: boolean
  actionError: boolean
  onAction: (resource: ManagedResource, action: ManagedResourceAction) => void
}

export function ManagedResourceCardView({
  resource,
  tasks,
  actionPending,
  actionError,
  onAction,
}: ManagedResourceCardViewProps) {
  const { t } = useTranslation('resources')
  const [confirming, setConfirming] = useState(false)
  const progress = projectResourceTransferProgress(tasks)
  const primaryAction = resource.actions.update.available
    ? 'update'
    : resource.actions.install.available
      ? 'install'
      : null
  const installing = progress.activeTasks.length > 0 || resource.state === 'installing'
  const KindIcon = resource.kind === 'runtime'
    ? RuntimeIcon
    : resource.kind === 'model'
      ? ModelIcon
      : DownloadIcon

  return (
    <article
      className="overflow-hidden rounded-lg border border-border/60 bg-card"
      data-testid={`managed-resource-${managedResourceKey(resource)}`}
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted text-muted-foreground">
          <KindIcon className="size-4" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">
              {resource.displayName}
            </span>
            <span
              className={cn(
                'shrink-0 rounded-md px-1.5 py-px text-[10.5px]',
                STATE_BADGE_CLASS[resource.state],
              )}
            >
              {t(`state.${resource.state}`)}
            </span>
            {resource.required
              ? (
                  <span className="shrink-0 rounded-md bg-fill px-1.5 py-px text-[10.5px] text-muted-foreground">
                    {t('required')}
                  </span>
                )
              : null}
          </div>
          <p className="mt-0.5 text-[10.5px] capitalize text-muted-foreground/70">
            {resource.kind}
            {resource.installationSource
              ? ` · ${t(`source.${resource.installationSource}`)}`
              : null}
          </p>
          {resource.description
            ? (
                <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                  {resource.description}
                </p>
              )
            : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {confirming
            ? (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2.5 text-[12px] active:scale-[0.96]"
                    onClick={() => {
                      onAction(resource, 'uninstall')
                      setConfirming(false)
                    }}
                  >
                    {t('action.uninstall')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[12px] text-muted-foreground active:scale-[0.96]"
                    onClick={() => setConfirming(false)}
                  >
                    {t('action.cancel')}
                  </Button>
                </div>
              )
            : primaryAction
              ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={primaryAction === 'update' ? 'default' : 'outline'}
                    className="h-7 gap-1.5 px-2.5 text-[12px] active:scale-[0.96]"
                    disabled={actionPending || progress.activeTasks.length > 0}
                    onClick={() => onAction(resource, primaryAction)}
                  >
                    {primaryAction === 'update'
                      ? <UpdateIcon data-icon="inline-start" />
                      : <DownloadIcon data-icon="inline-start" />}
                    {resource.installationSource === 'external'
                      && primaryAction === 'install'
                      ? t('action.installManaged')
                      : t(`action.${primaryAction}`)}
                  </Button>
                )
              : installing && progress.percent !== null
                ? (
                    <span className="px-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {progress.percent}
                      %
                    </span>
                  )
                : null}
          {resource.actions.uninstall.available && !confirming
            ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t('action.uninstall')}
                  onClick={() => setConfirming(true)}
                >
                  <DeleteIcon className="size-3.5" aria-hidden="true" />
                </Button>
              )
            : null}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-border/40 bg-muted/20 px-3.5 py-2">
        <span className="text-[10.5px] text-muted-foreground/60">
          {t('version.installed')}
          {' '}
          <span className="font-mono text-foreground/70">
            {resource.installedVersion ?? '-'}
          </span>
        </span>
        {resource.availableVersion !== null
          && resource.availableVersion !== resource.installedVersion
          ? (
              <span className="flex items-center gap-1 text-[10.5px]">
                <span className="text-muted-foreground/40">{'->'}</span>
                <span className="font-mono text-warning">{resource.availableVersion}</span>
              </span>
            )
          : null}
        {resource.installedSizeBytes !== null
          ? (
              <span className="ml-auto font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
                {formatCompactBytes(resource.installedSizeBytes)}
              </span>
            )
          : null}
      </div>

      {installing
        ? (
            <div className="border-t border-border/40 px-3.5 py-2.5">
              <div
                className="h-[3px] overflow-hidden rounded-full bg-border/60"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent ?? undefined}
              >
                <div
                  className={cn(
                    'h-full rounded-full bg-primary transition-[width] duration-150',
                    progress.percent === null && 'w-1/3',
                  )}
                  style={progress.percent === null
                    ? undefined
                    : { width: `${progress.percent}%` }}
                />
              </div>
              {progress.activeTasks.length > 0
                ? (
                    <p className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {formatCompactBytes(progress.transferredBytes)}
                      {progress.totalBytes === null
                        ? ''
                        : ` / ${formatCompactBytes(progress.totalBytes)}`}
                    </p>
                  )
                : null}
            </div>
          )
        : null}

      {actionError
        || (!actionError && progress.failedTask && resource.state !== 'installed')
        ? (
            <div className="border-t border-border/40 px-3.5 py-2">
              <p className="text-[11px] text-destructive">
                {actionError ? t('action.failed') : t('transfer.failed')}
              </p>
            </div>
          )
        : null}
    </article>
  )
}
