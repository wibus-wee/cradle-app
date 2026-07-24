import { DownloadLine as DownloadIcon, Refresh1Line as UpdateIcon } from '@mingcute/react'
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
import type { DownloadTask } from '~/features/download-center/types'

import { ManagedResourceCardView } from './managed-resource-card-view'
import type { ManagedResource } from './projection'
import { managedResourceKey, taskBelongsToResource } from './projection'
import type { ManagedResourceAction } from './use-managed-resources'

export interface ManagedResourceLibraryViewProps {
  resources: ManagedResource[]
  tasks: readonly DownloadTask[]
  loading: boolean
  error: boolean
  actionResourceKey: string | null
  actionPending: boolean
  actionError: boolean
  onRetry: () => void
  onAction: (resource: ManagedResource, action: ManagedResourceAction) => void
}

export function ManagedResourceLibraryView({
  resources,
  tasks,
  loading,
  error,
  actionResourceKey,
  actionPending,
  actionError,
  onRetry,
  onAction,
}: ManagedResourceLibraryViewProps) {
  const { t } = useTranslation('resources')

  if (loading && resources.length === 0) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {[0, 1, 2, 3].map(index => (
          <div key={index} className="overflow-hidden rounded-lg border border-border/60 bg-card">
            <div className="flex items-start gap-3 px-3.5 py-3">
              <Skeleton className="size-8 shrink-0 rounded-md" />
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

  if (error) {
    return (
      <Empty className="border-0 py-24">
        <EmptyHeader>
          <EmptyMedia variant="icon"><DownloadIcon /></EmptyMedia>
          <EmptyTitle>{t('loadError')}</EmptyTitle>
          <EmptyDescription>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
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
      {resources.map((resource) => {
        const key = managedResourceKey(resource)
        const ownsAction = key === actionResourceKey
        return (
          <ManagedResourceCardView
            key={key}
            resource={resource}
            tasks={tasks.filter(task => taskBelongsToResource(task, resource))}
            actionPending={ownsAction && actionPending}
            actionError={ownsAction && actionError}
            onAction={onAction}
          />
        )
      })}
    </div>
  )
}
