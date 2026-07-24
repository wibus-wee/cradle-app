import { GitBranchLine as GitBranchIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import { formatPullRequestDate } from './pull-request-list-presenter'
import { CHECKS_DOT_CLASS, STATUS_ICON, STATUS_ICON_CLASS, statusKind } from './status-meta'
import type { CradlePullRequest } from './use-pull-requests'

export interface PullRequestRowViewProps {
  item: CradlePullRequest
  active: boolean
  locale: string
  now: number
  onPrefetch: () => void
  onSelect: () => void
}

export function PullRequestRowView({
  item,
  active,
  locale,
  now,
  onPrefetch,
  onSelect,
}: PullRequestRowViewProps) {
  const { t } = useTranslation('pull-requests')
  const pullRequest = item.pullRequest
  const status = statusKind(pullRequest)
  const StatusIcon = STATUS_ICON[status]
  const checksDotClass = CHECKS_DOT_CLASS[pullRequest.checksState]
  const hasDiffStat = pullRequest.additions !== undefined
    && pullRequest.deletions !== undefined

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      aria-current={active ? 'true' : undefined}
      data-testid={`pull-request-row-${item.id}`}
      className={cn(
        'group h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left font-normal transition-colors',
        active ? 'bg-muted hover:bg-muted' : 'hover:bg-muted/60',
      )}
    >
      <span className={cn('relative shrink-0', STATUS_ICON_CLASS[status])}>
        <StatusIcon className="size-4" aria-hidden="true" />
        {checksDotClass
          ? (
              <span
                className={cn(
                  'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full outline outline-2 outline-background',
                  checksDotClass,
                )}
                aria-hidden="true"
              />
            )
          : null}
        <span className="sr-only">{t(`status.${status}`)}</span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90 group-hover:text-foreground">
            {pullRequest.title}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
            {formatPullRequestDate(pullRequest.updatedAt, locale, now)}
          </span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="shrink-0 font-mono font-medium text-foreground/55">
            {pullRequest.owner}
            /
            {pullRequest.repo}
            {' #'}
            {pullRequest.number}
          </span>
          <span aria-hidden="true">·</span>
          <span className="flex min-w-0 items-center gap-1 truncate font-mono">
            <GitBranchIcon className="size-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{pullRequest.headRef}</span>
          </span>
          <span className="ml-auto hidden shrink-0 items-center gap-2.5 sm:flex">
            {pullRequest.author
              ? (
                  <span className="flex items-center gap-1">
                    <img
                      src={pullRequest.author.avatarUrl}
                      alt=""
                      className="size-3.5 rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                    />
                    <span className="truncate text-muted-foreground/80">
                      {pullRequest.author.login}
                    </span>
                  </span>
                )
              : null}
            {hasDiffStat
              ? (
                  <span className="flex items-center gap-1 font-mono tabular-nums">
                    <span className="text-success">
                      +
                      {pullRequest.additions}
                    </span>
                    <span className="text-destructive">
                      -
                      {pullRequest.deletions}
                    </span>
                  </span>
                )
              : null}
          </span>
        </span>
      </span>
    </Button>
  )
}
