/**
 * Codex review composer slot UI.
 *
 * Review mode is a chat-owned picker opened by the `/review` UI action. It
 * builds native Codex review prompts without sending raw slash text.
 */
import {
  ArrowLeftLine as ArrowLeftIcon,
  CheckCircleLine as CheckCircle2Icon,
  CloseLine as XIcon,
  GitBranchLine as GitBranchIcon,
  Refresh1Line as RefreshCwIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'

import type { GetWorkspacesByWorkspaceIdGitBranchesResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Spinner } from '~/components/ui/spinner'
import { useGitBranches, useGitRepositories, useGitStatus } from '~/features/git/use-git'
import { cn } from '~/lib/cn'

import {
  buildCodexReviewPrompt,
  createCodexReviewBranchLines,
} from '../../capabilities/codex-review-mode'
import { ComposerSlotIconAction, ComposerSlotShell } from './composer-slot-shell'
import type { ComposerReviewSlotActions } from './types'

type ReviewStep = 'choose-target' | 'choose-base'

export function ReviewSlotState({
  review,
  className,
}: {
  review: ComposerReviewSlotActions
  className?: string
}) {
  const [step, setStep] = useState<ReviewStep>('choose-target')
  const [submittingBranchName, setSubmittingBranchName] = useState<string | null>(null)
  const [submittingUncommitted, setSubmittingUncommitted] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const repositoriesQuery = useGitRepositories(review.open ? review.workspaceId : null)
  const selectedRepository = repositoriesQuery.data?.length === 1 ? repositoriesQuery.data[0] : null
  const repositoryPath = selectedRepository?.path ?? null
  const statusQuery = useGitStatus(repositoryPath ? review.workspaceId : null, repositoryPath)
  const branchesQuery = useGitBranches(repositoryPath ? review.workspaceId : null, repositoryPath)
  const currentBranch = statusQuery.data?.branch ?? null
  const branchLines = useMemo(() => createCodexReviewBranchLines({
    branches: branchesQuery.data as GetWorkspacesByWorkspaceIdGitBranchesResponse | null | undefined,
    currentBranch,
  }), [branchesQuery.data, currentBranch])
  const loadingBaseBranches = repositoriesQuery.isLoading || branchesQuery.isLoading || statusQuery.isLoading
  const hasWorkspace = Boolean(review.workspaceId)
  const repositoryCount = repositoriesQuery.data?.length ?? 0
  const gitUnavailable = repositoriesQuery.isError
    || statusQuery.isError
    || branchesQuery.isError
    || (repositoriesQuery.isSuccess && repositoryCount !== 1)
  const busy = submittingUncommitted || submittingBranchName !== null

  function dismissReview() {
    if (busy) {
      return
    }
    review.onDismiss()
  }

  function submitUncommittedReview() {
    setErrorText(null)
    setSubmittingUncommitted(true)
    try {
      review.onSubmitPrompt(buildCodexReviewPrompt({
        mode: 'uncommitted',
        sourceBranch: currentBranch ?? 'HEAD',
        repositoryPath,
      }))
      review.onDismiss()
    }
    finally {
      setSubmittingUncommitted(false)
    }
  }

  async function submitBaseBranchReview(baseBranch: string) {
    setErrorText(null)
    setSubmittingBranchName(baseBranch)
    try {
      const mergeBaseSha = await review.resolveMergeBase(baseBranch, repositoryPath)
      if (!mergeBaseSha) {
        throw new Error(`Failed to resolve a merge base between HEAD and ${baseBranch}.`)
      }
      review.onSubmitPrompt(buildCodexReviewPrompt({
        mode: 'base-branch',
        sourceBranch: currentBranch ?? 'HEAD',
        repositoryPath,
        baseBranch,
        mergeBaseSha,
      }))
      review.onDismiss()
    }
    catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to start code review.')
    }
    finally {
      setSubmittingBranchName(null)
    }
  }

  return (
    <ComposerSlotShell stateName="review" testId="codex-review-mode-slot" className={cn('py-2', className)}>
      <div className="mb-2 flex h-6 min-w-0 items-center gap-2">
        <GitBranchIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <span className="font-medium text-foreground/80">Code review</span>
          <span className="ml-1.5 text-muted-foreground">
            {step === 'choose-base' ? 'Choose base branch' : 'Choose target'}
          </span>
        </div>
        <ComposerSlotIconAction label="Close review picker" disabled={busy} onClick={dismissReview}>
          <XIcon className="size-3.5" aria-hidden="true" />
        </ComposerSlotIconAction>
      </div>

      {!hasWorkspace && (
        <ReviewSlotNotice tone="danger">
          Open a workspace-backed Codex chat before starting review mode.
        </ReviewSlotNotice>
      )}

      {gitUnavailable && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          <span>{repositoryCount > 1 ? 'Choose a workspace with one Git repository for review mode.' : 'Git repository unavailable.'}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              void repositoriesQuery.refetch()
              void statusQuery.refetch()
              void branchesQuery.refetch()
            }}
            className="h-7 shrink-0 gap-1 rounded-sm px-2 text-xs font-medium hover:bg-destructive/10"
          >
            <RefreshCwIcon className="size-3" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {errorText && (
        <ReviewSlotNotice tone="danger">
          {errorText}
        </ReviewSlotNotice>
      )}

      {step === 'choose-target'
        ? (
            <div className="grid gap-1.5 sm:grid-cols-2">
              <ReviewOptionButton
                title="Review uncommitted changes"
                description="Staged, unstaged, and untracked files"
                disabled={!hasWorkspace || gitUnavailable || submittingUncommitted}
                loading={submittingUncommitted}
                onClick={submitUncommittedReview}
              />
              <ReviewOptionButton
                title="Review against base branch"
                description={currentBranch ? `Compare ${currentBranch} with another branch` : 'Compare HEAD with another branch'}
                disabled={!hasWorkspace || gitUnavailable || loadingBaseBranches}
                loading={loadingBaseBranches}
                onClick={() => {
                  setErrorText(null)
                  setStep('choose-base')
                }}
              />
            </div>
          )
        : (
            <div className="grid gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => setStep('choose-target')}
                className="h-7 w-fit gap-1 rounded-sm px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
                Back
              </Button>
              <ScrollArea className="max-h-44 rounded-md border border-border/70" viewportClassName="max-h-44">
                <div className="grid gap-1 p-1">
                  {branchLines.length === 0 && !loadingBaseBranches && (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No base branches found.
                    </div>
                  )}
                  {loadingBaseBranches && (
                    <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
                      <Spinner className="size-3.5" aria-hidden="true" />
                      Loading branches
                    </div>
                  )}
                  {branchLines.map(branch => (
                    <Button
                      key={branch.key}
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void submitBaseBranchReview(branch.label)}
                      className={cn(
                        'h-8 min-w-0 justify-start gap-2 rounded-sm px-2 text-left text-xs hover:bg-muted disabled:opacity-60',
                        submittingBranchName === branch.label && 'bg-muted',
                      )}
                    >
                      <GitBranchIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-foreground/85">{branch.label}</span>
                      {submittingBranchName === branch.label && (
                        <Spinner className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
                      )}
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
    </ComposerSlotShell>
  )
}

function ReviewSlotNotice({
  tone,
  children,
}: {
  tone: 'danger'
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'mb-2 rounded-md border px-2.5 py-2 text-xs',
        tone === 'danger' && 'border-destructive/20 bg-destructive/5 text-destructive',
      )}
    >
      {children}
    </div>
  )
}

function ReviewOptionButton({
  title,
  description,
  disabled,
  loading,
  onClick,
}: {
  title: string
  description: string
  disabled: boolean
  loading?: boolean
  onClick: () => void
}) {
  const Icon = loading ? Spinner : CheckCircle2Icon
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      className="h-auto min-h-12 min-w-0 justify-start gap-2 rounded-md border-border/70 px-2.5 py-2 text-left whitespace-normal hover:bg-muted disabled:opacity-60"
    >
      <Icon className={cn('size-3.5 shrink-0 text-muted-foreground', loading && 'animate-spin')} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{description}</span>
      </span>
    </Button>
  )
}
