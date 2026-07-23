import {
  CheckCircleLine as CheckCircleIcon,
  CloseCircleLine as XCircleIcon,
  GitBranchLine as GitBranchIcon,
  LoadingLine as LoaderIcon,
  User2Line as UserIcon,
} from '@mingcute/react'

import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/cn'

import type { CradleDiffReview } from '../shared/types'

type PullRequestBinding = NonNullable<CradleDiffReview['githubPullRequest']>
type PullRequestDetail = NonNullable<PullRequestBinding['detail']>

const CHECK_TONE: Record<PullRequestDetail['checksState'], string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  failure: 'text-red-600 dark:text-red-400',
  pending: 'text-amber-600 dark:text-amber-400',
  neutral: 'text-muted-foreground',
}

function CheckStateIcon({ state, className }: { state: PullRequestDetail['checksState'], className?: string }) {
  if (state === 'success') {
    return <CheckCircleIcon className={cn('size-3.5', className)} />
  }
  if (state === 'failure') {
    return <XCircleIcon className={cn('size-3.5', className)} />
  }
  return <LoaderIcon className={cn('size-3.5', state === 'pending' && 'animate-spin', className)} />
}

function ActorAvatars({ detail }: { detail: PullRequestDetail }) {
  const actors = [detail.author, ...detail.reviewers].filter(actor => actor !== null)
  if (actors.length === 0) {
    return <span className="text-[11px] text-muted-foreground">No reviewers</span>
  }
  return (
    <AvatarGroup>
      {actors.slice(0, 5).map(actor => (
        <Avatar key={actor.login} size="sm" title={actor.login}>
          {actor.avatarUrl && <AvatarImage src={actor.avatarUrl} alt="" />}
          <AvatarFallback>{actor.login.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      ))}
    </AvatarGroup>
  )
}

export function GitHubReviewContext({
  pullRequest,
  onMerge,
  mergePending,
}: {
  pullRequest: PullRequestBinding
  onMerge: (method: 'merge' | 'squash' | 'rebase') => void
  mergePending: boolean
}) {
  const detail = pullRequest.detail
  if (!detail) {
    return null
  }
  const completedChecks = detail.checks.filter(check => check.status === 'completed').length
  const canMerge = detail.state === 'open'
    && !detail.merged
    && !detail.isDraft
    && detail.mergeable === true
    && (detail.checksState === 'success' || detail.checksState === 'neutral')

  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1.5 px-2 text-[12px]', CHECK_TONE[detail.checksState])}
            aria-label="Pull request status and checks"
          >
            <CheckStateIcon state={detail.checksState} />
            {detail.checks.length > 0 ? `${completedChecks}/${detail.checks.length}` : 'PR details'}
          </Button>
        )}
      />
      <PopoverContent align="end" className="max-h-[min(620px,80vh)] w-[420px] gap-0 overflow-y-auto p-0">
        <div className="border-b border-border px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-foreground">{detail.title}</p>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <GitBranchIcon className="size-3 shrink-0" />
                <span className="truncate">{detail.headRef}</span>
                <span aria-hidden>to</span>
                <span className="truncate">{detail.baseRef}</span>
              </div>
            </div>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
              {detail.merged ? 'merged' : detail.isDraft ? 'draft' : detail.state}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <ActorAvatars detail={detail} />
            <span className="text-[11px] text-muted-foreground">
              {detail.mergeable === false ? 'Merge blocked' : detail.mergeable === true ? 'Mergeable' : detail.mergeableState}
            </span>
          </div>
          {detail.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {detail.labels.map(label => (
                <span key={label.name} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: `#${label.color}` }} aria-hidden />
                  {label.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <section className="border-b border-border px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase text-muted-foreground">Checks</h2>
            <span className={cn('text-[11px] capitalize', CHECK_TONE[detail.checksState])}>{detail.checksState}</span>
          </div>
          {detail.checks.length === 0
            ? <p className="text-[12px] text-muted-foreground">No checks reported</p>
            : (
                <div className="space-y-1">
                  {detail.checks.map(check => (
                    <a
                      key={check.id}
                      href={check.url ?? undefined}
                      target={check.url ? '_blank' : undefined}
                      rel={check.url ? 'noreferrer' : undefined}
                      className={cn(
                        'flex min-h-7 items-center gap-2 rounded px-1.5 text-[12px]',
                        check.url && 'hover:bg-muted',
                      )}
                    >
                      <CheckStateIcon
                        state={check.status !== 'completed'
                          ? 'pending'
                          : check.conclusion === 'success' ? 'success' : 'failure'}
                        className="shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">{check.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{check.conclusion ?? check.status}</span>
                    </a>
                  ))}
                </div>
              )}
        </section>

        <section className="px-3 py-2.5">
          <h2 className="mb-2 text-[11px] font-medium uppercase text-muted-foreground">Activity</h2>
          {detail.timeline.length === 0
            ? <p className="text-[12px] text-muted-foreground">No review activity yet</p>
            : (
                <div className="space-y-2.5">
                  {detail.timeline.slice(-20).toReversed().map(item => (
                    <a
                      key={item.id}
                      href={item.url ?? undefined}
                      target={item.url ? '_blank' : undefined}
                      rel={item.url ? 'noreferrer' : undefined}
                      className={cn('flex gap-2 rounded', item.url && 'hover:bg-muted')}
                    >
                      <UserIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-medium text-foreground/80">
                          {item.author?.login ?? 'GitHub'}
{' '}
{item.kind === 'review' ? item.state?.toLowerCase() ?? 'reviewed' : 'commented'}
                        </span>
                        {item.body && <span className="line-clamp-2 whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground">{item.body}</span>}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                    </a>
                  ))}
                </div>
              )}
        </section>

        {detail.state === 'open' && !detail.merged && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5">
            <span className="text-[11px] text-muted-foreground">
              {detail.isDraft
                ? 'Draft pull request'
                : detail.checksState === 'pending'
                  ? 'Checks are running'
                  : detail.checksState === 'failure'
                    ? 'Checks are failing'
                    : detail.mergeable !== true ? 'Merge is blocked' : 'Ready to merge'}
            </span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={!canMerge || mergePending} onClick={() => onMerge('merge')}>
                Merge
              </Button>
              <Button size="sm" className="h-7 px-2 text-[11px]" disabled={!canMerge || mergePending} onClick={() => onMerge('squash')}>
                Squash
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={!canMerge || mergePending} onClick={() => onMerge('rebase')}>
                Rebase
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
