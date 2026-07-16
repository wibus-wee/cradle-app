import {
  DeleteLine as DeleteIcon,
  DownloadLine as DownloadIcon,
  DriveLine as ModelIcon,
  Refresh1Line as UpdateIcon,
  TerminalBoxLine as RuntimeIcon,
} from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Skeleton } from '~/components/ui/skeleton'
import { DownloadTaskRow } from '~/features/download-center/download-center-chrome'
import type { DownloadTask } from '~/features/download-center/types'
import { isActiveDownload } from '~/features/download-center/types'
import {
  useDownloadCenter,
  useDownloadCenterOwner,
} from '~/features/download-center/use-download-center'
import { cn } from '~/lib/cn'
import { formatCompactBytes } from '~/lib/number-format'

import { getManagedResourcesQueryKey } from './api/managed-resources-api'
import type { ManagedResource } from './projection'
import { managedResourceKey, projectResourceTransferProgress } from './projection'
import { useManagedResourceAction, useManagedResources } from './use-managed-resources'

type PageFace = 'library' | 'activity'
type TransferStatusFilter = 'all' | 'active' | 'completed' | 'failed' | 'cancelled'
type TransferScopeFilter = 'all' | DownloadTask['scope']

const STATE_BADGE_CLASS: Record<ManagedResource['state'], string> = {
  'installed': 'bg-success/10 text-success',
  'update-available': 'bg-warning/10 text-warning',
  'installing': 'bg-primary/10 text-primary',
  'not-installed': 'bg-fill text-muted-foreground',
  'error': 'bg-destructive/10 text-destructive',
  'unavailable': 'bg-fill text-muted-foreground/60',
}

function stateKey(state: ManagedResource['state']) {
  return `state.${state}` as const
}

function KindGlyph({ kind }: { kind: string }) {
  if (kind === 'runtime') {
    return <RuntimeIcon className="size-4" aria-hidden="true" />
  }
  if (kind === 'model') {
    return <ModelIcon className="size-4" aria-hidden="true" />
  }
  return <DownloadIcon className="size-4" aria-hidden="true" />
}

function ProgressLine({ percent }: { percent: number | null }) {
  return (
    <div
      className="h-[3px] overflow-hidden rounded-full bg-border/60"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      <div
        className={cn(
          'h-full rounded-full bg-primary transition-[width] duration-150',
          percent === null && 'w-1/3',
        )}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  )
}

function ResourceCard({ resource }: { resource: ManagedResource }) {
  const { t } = useTranslation('resources')
  const queryClient = useQueryClient()
  const tasks = useDownloadCenterOwner(resource.key)
  const progress = projectResourceTransferProgress(tasks)
  const action = useManagedResourceAction(resource)
  const [confirming, setConfirming] = useState(false)
  const terminalRevision = tasks
    .filter(task => !isActiveDownload(task))
    .map(task => `${task.taskId}:${task.status}:${task.updatedAt}`)
    .join('|')
  const previousTerminalRevisionRef = useRef(terminalRevision)
  const primaryAction = resource.actions.update.available
    ? 'update'
    : resource.actions.install.available
      ? 'install'
      : null
  const installing = progress.activeTasks.length > 0 || resource.state === 'installing'

  useEffect(() => {
    if (previousTerminalRevisionRef.current === terminalRevision) {
      return
    }
    previousTerminalRevisionRef.current = terminalRevision
    void queryClient.invalidateQueries({ queryKey: getManagedResourcesQueryKey() })
  }, [queryClient, terminalRevision])

  return (
    <div
      className="overflow-hidden rounded-xl border border-border/60 bg-card"
      data-testid={`managed-resource-${managedResourceKey(resource)}`}
    >
      {/* Main row */}
      <div className="flex items-start gap-3 px-3.5 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted text-muted-foreground">
          <KindGlyph kind={resource.kind} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">
              {resource.displayName}
            </span>
            <span className={cn('shrink-0 rounded-md px-1.5 py-px text-[10.5px]', STATE_BADGE_CLASS[resource.state])}>
              {t(stateKey(resource.state))}
            </span>
            {resource.required && (
              <span className="shrink-0 rounded-md bg-fill px-1.5 py-px text-[10.5px] text-muted-foreground">
                {t('required')}
              </span>
            )}
          </div>
          <p className="mt-0.5 capitalize text-[10.5px] text-muted-foreground/70">
            {resource.kind}
            {resource.installationSource && (
              <>
{' '}
·
{t(`source.${resource.installationSource}`)}
              </>
            )}
          </p>
          {resource.description && (
            <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
              {resource.description}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {confirming
            ? (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2.5 text-[12px] active:scale-[0.96]"
                    onClick={() => { action.mutate('uninstall'); setConfirming(false) }}
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
                    disabled={action.isPending || progress.activeTasks.length > 0}
                    onClick={() => action.mutate(primaryAction)}
                  >
                    {primaryAction === 'update'
                      ? <UpdateIcon data-icon="inline-start" />
                      : <DownloadIcon data-icon="inline-start" />}
                    {resource.installationSource === 'external' && primaryAction === 'install'
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
          {resource.actions.uninstall.available && !confirming && (
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
          )}
        </div>
      </div>

      {/* Meta footer */}
      <div className="flex items-center gap-3 border-t border-border/40 bg-muted/20 px-3.5 py-2">
        <span className="text-[10.5px] text-muted-foreground/60">
          {t('version.installed')}
          {' '}
          <span className="font-mono text-foreground/70">{resource.installedVersion ?? '—'}</span>
        </span>
        {resource.availableVersion && resource.availableVersion !== resource.installedVersion && (
          <span className="flex items-center gap-1 text-[10.5px]">
            <span className="text-muted-foreground/40">→</span>
            <span className="font-mono text-warning">{resource.availableVersion}</span>
          </span>
        )}
        {resource.installedSizeBytes !== null && (
          <span className="ml-auto font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
            {formatCompactBytes(resource.installedSizeBytes)}
          </span>
        )}
      </div>

      {/* Progress (only when installing) */}
      {installing && (
        <div className="border-t border-border/40 px-3.5 py-2.5">
          <ProgressLine percent={progress.percent} />
          {progress.activeTasks.length > 0 && (
            <p className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatCompactBytes(progress.transferredBytes)}
              {progress.totalBytes === null ? '' : ` / ${formatCompactBytes(progress.totalBytes)}`}
            </p>
          )}
        </div>
      )}

      {/* Error messages */}
      {(action.isError || (!action.isError && progress.failedTask && resource.state !== 'installed')) && (
        <div className="border-t border-border/40 px-3.5 py-2">
          <p className="text-[11px] text-destructive">
            {action.isError ? t('action.failed') : t('transfer.failed')}
          </p>
        </div>
      )}
    </div>
  )
}

const MemoizedResourceCard = memo(ResourceCard)

function LibraryFace() {
  const { t } = useTranslation('resources')
  const { resources, isLoading, isError, refetch } = useManagedResources()

  if (isLoading && resources.length === 0) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {[0, 1, 2, 3].map(index => (
          <div
            key={index}
            className="overflow-hidden rounded-xl border border-border/60 bg-card"
          >
            <div className="flex items-start gap-3 px-3.5 py-3">
              <Skeleton className="size-8 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2 pt-0.5">
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-2.5 w-2/5" />
                <Skeleton className="h-2.5 w-4/5" />
              </div>
            </div>
            <div className="border-t border-border/40 bg-muted/20 px-3.5 py-2">
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <Empty className="border-0 py-24">
        <EmptyHeader>
          <EmptyMedia variant="icon"><DownloadIcon /></EmptyMedia>
          <EmptyTitle>{t('loadError')}</EmptyTitle>
          <EmptyDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 transition-transform active:scale-[0.96]"
              onClick={() => void refetch()}
            >
              <UpdateIcon data-icon="inline-start" />
              {t('action.retry')}
            </Button>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (resources.length === 0) {
    return (
      <Empty className="border-0 py-24">
        <EmptyHeader>
          <EmptyMedia variant="icon"><DownloadIcon /></EmptyMedia>
          <EmptyTitle>{t('empty.resources')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {resources.map(resource => (
        <MemoizedResourceCard key={managedResourceKey(resource)} resource={resource} />
      ))}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-6 rounded-md px-2.5 text-[11px] font-medium transition-colors',
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function ActivityFace() {
  const { t } = useTranslation('resources')
  const { tasks } = useDownloadCenter()
  const [status, setStatus] = useState<TransferStatusFilter>('all')
  const [scope, setScope] = useState<TransferScopeFilter>('all')
  const visibleTasks = useMemo(() => tasks
    .filter(task => scope === 'all' || task.scope === scope)
    .filter((task) => {
      if (status === 'all') { return true }
      if (status === 'active') { return isActiveDownload(task) }
      return task.status === status
    })
    .toSorted((left, right) =>
      Number(isActiveDownload(right)) - Number(isActiveDownload(left))
      || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)), [scope, status, tasks])

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground/70">{t('filter.channel')}</span>
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5">
            {(['all', 'server', 'desktop'] as const).map(value => (
              <FilterChip
                key={value}
                active={scope === value}
                onClick={() => setScope(value)}
              >
                {t(`filter.scope.${value}`)}
              </FilterChip>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5">
          {(['all', 'active', 'completed', 'failed', 'cancelled'] as const).map(value => (
            <FilterChip
              key={value}
              active={status === value}
              onClick={() => setStatus(value)}
            >
              {t(`filter.status.${value}`)}
            </FilterChip>
          ))}
        </div>
      </div>

      {visibleTasks.length === 0
        ? (
            <Empty className="border-0 py-24">
              <EmptyHeader>
                <EmptyMedia variant="icon"><DownloadIcon /></EmptyMedia>
                <EmptyTitle>{t('empty.transfers')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )
        : (
            <div className="grid gap-2 sm:grid-cols-2">
              {visibleTasks.map(task => (
                <div
                  key={`${task.scope}:${task.taskId}`}
                  className="rounded-xl bg-muted/35 p-1 [contain-intrinsic-size:0_88px] [content-visibility:auto]"
                >
                  <DownloadTaskRow task={task} showFileName />
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

function FaceSwitch({
  face,
  onChange,
  libraryCount,
  activeTransferCount,
}: {
  face: PageFace
  onChange: (next: PageFace) => void
  libraryCount: number
  activeTransferCount: number
}) {
  const { t } = useTranslation('resources')

  return (
    <div className="flex items-end gap-4" role="group" aria-label={t('face.switch')}>
      {([
        { id: 'library' as const, count: libraryCount },
        { id: 'activity' as const, count: activeTransferCount },
      ]).map(({ id, count }) => {
        const isActive = face === id
        return (
          <Button
            key={id}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(id)}
            aria-pressed={isActive}
            className={cn(
              'relative h-9 gap-1.5 rounded-none px-0 text-[13px] hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/40',
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`tab.${id}`)}
            <span className="tabular-nums text-muted-foreground/60">{count}</span>
            {isActive && (
              <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-[1.5px] bg-foreground" />
            )}
          </Button>
        )
      })}
    </div>
  )
}

export function ManagedResourcesPage() {
  const { t } = useTranslation('resources')
  const { resources } = useManagedResources()
  const { active } = useDownloadCenter()
  const [face, setFace] = useState<PageFace>('library')
  const updateCount = useMemo(
    () => resources.filter(resource => resource.state === 'update-available').length,
    [resources],
  )
  const installedCount = useMemo(
    () => resources.filter(resource =>
      resource.state === 'installed' || resource.state === 'update-available').length,
    [resources],
  )
  const installingCount = useMemo(
    () => resources.filter(resource => resource.state === 'installing').length,
    [resources],
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="managed-resources-page">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">{t('title')}</h1>
            <span className="text-[12px] tabular-nums text-muted-foreground">{resources.length}</span>
          </div>
          <p className="mt-1 text-pretty text-[13px] text-muted-foreground">{t('description')}</p>
        </div>

        <p className="self-start text-[11px] tabular-nums text-muted-foreground/70">
          {t('summary.live', {
            transferring: active.length,
            updates: updateCount,
          })}
        </p>
      </header>

      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4">
        <FaceSwitch
          face={face}
          onChange={setFace}
          libraryCount={resources.length}
          activeTransferCount={active.length}
        />
        {face === 'library' && (
          <p className="text-[11px] tabular-nums text-muted-foreground/70">
            {t('summary.library', {
              declared: resources.length,
              installed: installedCount,
              installing: installingCount,
            })}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-5 py-6">
          {face === 'library' ? <LibraryFace /> : <ActivityFace />}
        </div>
      </div>
    </div>
  )
}
