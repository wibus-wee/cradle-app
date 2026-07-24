import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import type { DownloadTask } from '~/features/download-center/types'
import { cn } from '~/lib/cn'

import { ManagedResourceActivityView } from './managed-resource-activity-view'
import { ManagedResourceLibraryView } from './managed-resource-library-view'
import type { ManagedResource } from './projection'
import type { ManagedResourceAction } from './use-managed-resources'

export type ManagedResourcesPageFace = 'library' | 'activity'

export interface ManagedResourcesPageViewProps {
  resources: ManagedResource[]
  tasks: readonly DownloadTask[]
  activeTasks: readonly DownloadTask[]
  loading: boolean
  error: boolean
  actionResourceKey: string | null
  actionPending: boolean
  actionError: boolean
  initialFace?: ManagedResourcesPageFace
  onRetryResources: () => void
  onResourceAction: (
    resource: ManagedResource,
    action: ManagedResourceAction,
  ) => void
  onCancelTask: (task: DownloadTask) => void
  onRetryTask: (task: DownloadTask) => void
}

export function ManagedResourcesPageView({
  resources,
  tasks,
  activeTasks,
  loading,
  error,
  actionResourceKey,
  actionPending,
  actionError,
  initialFace = 'library',
  onRetryResources,
  onResourceAction,
  onCancelTask,
  onRetryTask,
}: ManagedResourcesPageViewProps) {
  const { t } = useTranslation('resources')
  const [face, setFace] = useState<ManagedResourcesPageFace>(initialFace)
  const updateCount = useMemo(
    () => resources.filter(resource => resource.state === 'update-available').length,
    [resources],
  )
  const installedCount = useMemo(
    () => resources.filter(
      resource => resource.state === 'installed'
        || resource.state === 'update-available',
    ).length,
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
            <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {resources.length}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-pretty text-[13px] text-muted-foreground">
            {t('description')}
          </p>
        </div>

        <p className="self-start text-[11px] tabular-nums text-muted-foreground/70">
          {t('summary.live', {
            transferring: activeTasks.length,
            updates: updateCount,
          })}
        </p>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4">
        <div className="flex items-end gap-4" role="group" aria-label={t('face.switch')}>
          {([
            { id: 'library' as const, count: resources.length },
            { id: 'activity' as const, count: activeTasks.length },
          ]).map(({ id, count }) => {
            const active = face === id
            return (
              <Button
                key={id}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFace(id)}
                aria-pressed={active}
                className={cn(
                  'relative h-9 gap-1.5 rounded-none px-0 text-[13px] hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/40',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`tab.${id}`)}
                <span className="tabular-nums text-muted-foreground/60">{count}</span>
                {active
                  ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 -bottom-px h-[1.5px] bg-foreground"
                      />
                    )
                  : null}
              </Button>
            )
          })}
        </div>
        {face === 'library'
          ? (
              <p className="hidden text-[11px] tabular-nums text-muted-foreground/70 sm:block">
                {t('summary.library', {
                  declared: resources.length,
                  installed: installedCount,
                  installing: installingCount,
                })}
              </p>
            )
          : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-5 sm:py-6">
          {face === 'library'
            ? (
                <ManagedResourceLibraryView
                  resources={resources}
                  tasks={tasks}
                  loading={loading}
                  error={error}
                  actionResourceKey={actionResourceKey}
                  actionPending={actionPending}
                  actionError={actionError}
                  onRetry={onRetryResources}
                  onAction={onResourceAction}
                />
              )
            : (
                <ManagedResourceActivityView
                  tasks={tasks}
                  onCancel={onCancelTask}
                  onRetry={onRetryTask}
                />
              )}
        </div>
      </div>
    </div>
  )
}
