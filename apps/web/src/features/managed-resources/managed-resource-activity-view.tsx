import { DownloadLine as DownloadIcon } from '@mingcute/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { DownloadTaskRowView } from '~/features/download-center/download-task-row-view'
import type { DownloadTask } from '~/features/download-center/types'
import { isActiveDownload } from '~/features/download-center/types'
import { cn } from '~/lib/cn'

type TransferStatusFilter = 'all' | 'active' | 'completed' | 'failed' | 'cancelled'
type TransferScopeFilter = 'all' | DownloadTask['scope']

const SCOPE_FILTERS: TransferScopeFilter[] = ['all', 'server', 'desktop']
const STATUS_FILTERS: TransferStatusFilter[] = [
  'all',
  'active',
  'completed',
  'failed',
  'cancelled',
]

export interface ManagedResourceActivityViewProps {
  tasks: readonly DownloadTask[]
  onCancel: (task: DownloadTask) => void
  onRetry: (task: DownloadTask) => void
}

export function ManagedResourceActivityView({
  tasks,
  onCancel,
  onRetry,
}: ManagedResourceActivityViewProps) {
  const { t } = useTranslation('resources')
  const [status, setStatus] = useState<TransferStatusFilter>('all')
  const [scope, setScope] = useState<TransferScopeFilter>('all')
  const visibleTasks = useMemo(
    () => tasks
      .filter(task => scope === 'all' || task.scope === scope)
      .filter((task) => {
        if (status === 'all') {
          return true
        }
        if (status === 'active') {
          return isActiveDownload(task)
        }
        return task.status === status
      })
      .toSorted(
        (left, right) => Number(isActiveDownload(right)) - Number(isActiveDownload(left))
          || Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      ),
    [scope, status, tasks],
  )

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground/70">
            {t('filter.channel')}
          </span>
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5">
            {SCOPE_FILTERS.map(value => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                className={cn(
                  'h-6 rounded-md px-2.5 text-[11px] font-medium transition-colors',
                  scope === value
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {t(`filter.scope.${value}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-muted/40 p-0.5">
          {STATUS_FILTERS.map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={cn(
                'h-6 shrink-0 rounded-md px-2.5 text-[11px] font-medium transition-colors',
                status === value
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {t(`filter.status.${value}`)}
            </button>
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
                  className="rounded-lg bg-muted/35 p-1 [contain-intrinsic-size:0_88px] [content-visibility:auto]"
                >
                  <DownloadTaskRowView
                    task={task}
                    showFileName
                    onCancel={onCancel}
                    onRetry={onRetry}
                  />
                </div>
              ))}
            </div>
          )}
    </div>
  )
}
