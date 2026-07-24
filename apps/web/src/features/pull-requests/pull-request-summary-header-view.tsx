import { GitBranchLine as GitBranchIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import type { PullRequestDetail } from './api/pull-requests'
import { formatPullRequestRelativeTime } from './pull-request-detail-presenter'
import { STATUS_ICON, STATUS_ICON_CLASS, statusKind } from './status-meta'

export interface PullRequestSummaryHeaderViewProps {
  pullRequest: PullRequestDetail['pullRequest']
  now: number
}

export function PullRequestSummaryHeaderView({
  pullRequest,
  now,
}: PullRequestSummaryHeaderViewProps) {
  const { t } = useTranslation('pull-requests')
  const status = statusKind(pullRequest)
  const StatusIcon = STATUS_ICON[status]

  return (
    <header>
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <span className={cn('shrink-0', STATUS_ICON_CLASS[status])}>
          <StatusIcon className="size-3.5" aria-hidden="true" />
        </span>
        <span className="truncate font-mono">
          {pullRequest.owner}
          /
          {pullRequest.repo}
          {' #'}
          {pullRequest.number}
        </span>
        <span className="shrink-0 font-medium text-foreground/70">
          {t(`status.${status}`)}
        </span>
      </div>

      <h1 className="mt-2 text-balance text-2xl font-semibold leading-tight text-foreground">
        {pullRequest.title}
      </h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
        {pullRequest.author
          ? (
              <span className="flex items-center gap-1.5">
                <img
                  src={pullRequest.author.avatarUrl}
                  alt=""
                  className="size-4 rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                />
                <span className="text-foreground/80">{pullRequest.author.login}</span>
              </span>
            )
          : null}
        <span className="flex min-w-0 items-center gap-1.5 font-mono">
          <GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{pullRequest.headRef}</span>
          <span aria-hidden="true">{'->'}</span>
          <span className="truncate">{pullRequest.baseRef}</span>
        </span>
        <span className="font-mono tabular-nums">
          {t('detail.updated', {
            ago: formatPullRequestRelativeTime(pullRequest.updatedAtIso, now),
          })}
        </span>
      </div>

      {pullRequest.labels.length > 0
        ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {pullRequest.labels.map(label => (
                <span
                  key={label.name}
                  className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10.5px] text-foreground/70"
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: `#${label.color}` }}
                    aria-hidden="true"
                  />
                  {label.name}
                </span>
              ))}
            </div>
          )
        : null}
    </header>
  )
}
