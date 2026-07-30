import {
  CheckCircleLine as ApproveIcon,
  CheckLine as CheckIcon,
  CloseCircleLine as RequestChangesIcon,
  DownSmallLine as ChevronDownIcon,
  GitMergeLine as GitMergeIcon,
  Message1Line as CommentIcon,
  Refresh1Line as RefreshIcon,
} from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '~/components/ui/button-group'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import type { PullRequestDetail } from './api/pull-requests'

type PullRequest = PullRequestDetail['pullRequest']
type MergeMethod = PullRequest['allowedMergeMethods'][number]
export type PullRequestReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export interface PullRequestHeaderActionsViewProps {
  pullRequest: PullRequest
  pending: {
    review: boolean
    merge: boolean
    readyDraft: boolean
  }
  onReview: (event: PullRequestReviewEvent, body?: string) => void
  onMerge: (method: MergeMethod, commit?: { title?: string, message?: string }) => void
  onToggleReadyDraft: () => void
}

const MERGE_METHOD_LABEL = {
  merge: 'console.merge.merge',
  squash: 'console.merge.squash',
  rebase: 'console.merge.rebase',
} as const satisfies Record<MergeMethod, string>

const MERGE_BLOCKER_LABEL = {
  blocked: 'console.merge.blocker.blocked',
  checks_failure: 'console.merge.blocker.checks_failure',
  checks_pending: 'console.merge.blocker.checks_pending',
  conflicts: 'console.merge.blocker.conflicts',
  draft: 'console.merge.blocker.draft',
  mergeability_unknown: 'console.merge.blocker.mergeability_unknown',
  merged: 'console.merge.blocker.merged',
  no_merge_methods: 'console.merge.blocker.no_merge_methods',
  not_open: 'console.merge.blocker.not_open',
  unstable: 'console.merge.blocker.unstable',
} as const

export function PullRequestHeaderActionsView({
  pullRequest,
  pending,
  onReview,
  onMerge,
  onToggleReadyDraft,
}: PullRequestHeaderActionsViewProps) {
  const { t } = useTranslation('pull-requests')
  const [reviewEvent, setReviewEvent] = useState<Extract<PullRequestReviewEvent, 'REQUEST_CHANGES' | 'COMMENT'> | null>(null)
  const [reviewBody, setReviewBody] = useState('')
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>(
    pullRequest.allowedMergeMethods.includes('squash')
      ? 'squash'
      : pullRequest.allowedMergeMethods[0],
  )
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [commitTitle, setCommitTitle] = useState('')
  const [commitMessage, setCommitMessage] = useState('')

  function mergeBlockerText(code: string) {
    const key = MERGE_BLOCKER_LABEL[code as keyof typeof MERGE_BLOCKER_LABEL]
    return key ? t(key) : code
  }

  function submitReview() {
    if (!reviewEvent) {
      return
    }
    const body = reviewBody.trim()
    if (!body) {
      return
    }
    onReview(reviewEvent, body)
    setReviewEvent(null)
    setReviewBody('')
  }

  const mergeDisabled = pullRequest.isDraft || pending.merge || pullRequest.allowedMergeMethods.length === 0
  const mergeWarning = pullRequest.mergeBlockers
    .filter(code => code !== 'draft')
    .map(mergeBlockerText)

  function openMergeDialog() {
    setCommitTitle(`${pullRequest.title} (#${pullRequest.number})`)
    setCommitMessage('')
    setMergeDialogOpen(true)
  }

  function confirmMerge() {
    const title = commitTitle.trim()
    const message = commitMessage.trim()
    onMerge(mergeMethod, {
      ...(title ? { title } : {}),
      ...(message ? { message } : {}),
    })
    setMergeDialogOpen(false)
  }

  const mergeButton = (
    <Button
      type="button"
      size="xs"
      className="gap-1.5 rounded-r-none! px-2.5"
      disabled={mergeDisabled}
      onClick={openMergeDialog}
    >
      {pending.merge
        ? <RefreshIcon className="size-3 animate-spin" aria-hidden="true" />
        : <GitMergeIcon className="size-3" aria-hidden="true" />}
      {t(MERGE_METHOD_LABEL[mergeMethod])}
    </Button>
  )

  return (
    <>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <div className="flex flex-col items-end justify-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={pending.review}>
              <Button type="button" variant="outline" size="xs" className="gap-1.5">
                <ApproveIcon className="size-3 text-muted-foreground" aria-hidden="true" />
                {t('console.review.label')}
                <ChevronDownIcon className="size-3 opacity-60" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem
                onClick={() => onReview('APPROVE')}
                className="gap-2 text-xs"
              >
                <ApproveIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                {t('console.review.approve')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setReviewEvent('REQUEST_CHANGES')
                  setReviewBody('')
                }}
                className="gap-2 text-xs"
              >
                <RequestChangesIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
                {t('console.review.requestChanges')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setReviewEvent('COMMENT')
                  setReviewBody('')
                }}
                className="gap-2 text-xs"
              >
                <CommentIcon className="size-3.5" />
                {t('console.review.comment')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {pullRequest.isDraft
            ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={pending.readyDraft}
                  onClick={onToggleReadyDraft}
                >
                  {t('console.readyDraft.markReady')}
                </Button>
              )
            : null}

          <ButtonGroup>
            {mergeWarning.length > 0 && !pullRequest.isDraft
              ? (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex">{mergeButton}</span>} />
                    <TooltipContent className="max-w-60">
                      {mergeWarning.join(' · ')}
                    </TooltipContent>
                  </Tooltip>
                )
              : mergeButton}
            <ButtonGroupSeparator className="bg-primary-foreground/20" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={mergeDisabled}>
                <Button
                  type="button"
                  size="xs"
                  className="px-1.5"
                  aria-label={t('console.merge.label')}
                >
                  <ChevronDownIcon className="size-3 opacity-70" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                {pullRequest.allowedMergeMethods.map(method => (
                  <DropdownMenuItem
                    key={method}
                    onClick={() => setMergeMethod(method)}
                    className="gap-2 text-xs"
                  >
                    <CheckIcon
                      className={cn('size-3.5', method === mergeMethod ? 'opacity-100' : 'opacity-0')}
                      aria-hidden="true"
                    />
                    {t(MERGE_METHOD_LABEL[method])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
        </div>

        {!pullRequest.isDraft
          ? (
              <button
                type="button"
                disabled={pending.readyDraft}
                onClick={onToggleReadyDraft}
                className="text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {t('console.readyDraft.markDraft')}
              </button>
            )
          : null}
      </div>

      {reviewEvent
        ? (
            <div className="col-span-full flex items-end gap-2">
              <Textarea
                value={reviewBody}
                onChange={event => setReviewBody(event.target.value)}
                placeholder={t('console.review.bodyPlaceholder')}
                rows={3}
                className="min-h-14 flex-1 text-xs"
                disabled={pending.review}
                autoFocus
              />
              <Button
                type="button"
                size="sm"
                className="h-7 text-[11px]"
                disabled={pending.review || reviewBody.trim().length === 0}
                onClick={submitReview}
              >
                {t('console.review.submit')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                disabled={pending.review}
                onClick={() => {
                  setReviewEvent(null)
                  setReviewBody('')
                }}
              >
                {t('console.review.cancel')}
              </Button>
            </div>
          )
        : null}

      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('console.merge.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t(MERGE_METHOD_LABEL[mergeMethod])}
              {' · '}
              {pullRequest.headRef}
              {' -> '}
              {pullRequest.baseRef}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="pr-merge-commit-title" className="text-xs font-medium text-muted-foreground">
                {t('console.merge.commitTitle')}
              </label>
              <Input
                id="pr-merge-commit-title"
                value={commitTitle}
                onChange={event => setCommitTitle(event.target.value)}
                className="h-8 text-xs"
                disabled={pending.merge}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pr-merge-commit-message" className="text-xs font-medium text-muted-foreground">
                {t('console.merge.commitMessage')}
              </label>
              <Textarea
                id="pr-merge-commit-message"
                value={commitMessage}
                onChange={event => setCommitMessage(event.target.value)}
                rows={4}
                className="text-xs"
                disabled={pending.merge}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={pending.merge}
              onClick={() => setMergeDialogOpen(false)}
            >
              {t('console.review.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={pending.merge || commitTitle.trim().length === 0}
              onClick={confirmMerge}
            >
              {pending.merge
                ? <RefreshIcon className="size-3.5 animate-spin" aria-hidden="true" />
                : <GitMergeIcon className="size-3.5" aria-hidden="true" />}
              {t(MERGE_METHOD_LABEL[mergeMethod])}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
