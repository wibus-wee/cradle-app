import {
  GitCommitLine as GitCommitHorizontalIcon,
  GitPullRequestLine as GitPullRequestIcon,
  Magic2Line as WandSparklesIcon,
  Message1Line as MessageSquareCheckIcon,
  PlusLine as PlusIcon,
} from '@mingcute/react'
import type { FormEvent } from 'react'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

import type {
  GitHubAwaitTarget,
  GitHubRepository,
} from './await-github'
import {
  describeGitHubAwaitTargetInputIssue,
  parseGitHubAwaitTargetInput,
  parseGitHubRepositoryInput,
} from './await-github'
import { GitHubIcon } from './github-icon'
import type { GitHubReviewMode } from './use-live-await-status'

export type GitHubAwaitSourceKind = 'github-ci' | 'github-review'

export interface GitHubAwaitCreateInput {
  sourceKind: GitHubAwaitSourceKind
  reviewMode: GitHubReviewMode
  repository: Omit<GitHubRepository, 'remoteName' | 'remoteUrl'>
  target: GitHubAwaitTarget
}

export interface GitHubAwaitComposerViewProps {
  hasSession: boolean
  hasWorkspace: boolean
  detectedRepository: GitHubRepository | null
  detectedPullRequestNumber: number | null
  repositoryDetectionStatus: 'loading' | 'ready' | 'error'
  isCreating: boolean
  onCreate: (input: GitHubAwaitCreateInput) => void
}

export function GitHubAwaitComposerView({
  hasSession,
  hasWorkspace,
  detectedRepository,
  detectedPullRequestNumber,
  repositoryDetectionStatus,
  isCreating,
  onCreate,
}: GitHubAwaitComposerViewProps) {
  const [repositoryInput, setRepositoryInput] = useState('')
  const [targetInput, setTargetInput] = useState('')
  const [sourceKind, setSourceKind] = useState<GitHubAwaitSourceKind>('github-ci')
  const [reviewMode, setReviewMode] = useState<GitHubReviewMode>('approved')
  const repositoryEditedRef = useRef(false)
  const targetEditedRef = useRef(false)
  const repositoryInputId = useId()
  const targetInputId = useId()

  useEffect(() => {
    if (!repositoryEditedRef.current && detectedRepository?.fullName) {
      setRepositoryInput(detectedRepository.fullName)
    }
  }, [detectedRepository?.fullName])

  useEffect(() => {
    if (!targetEditedRef.current && detectedPullRequestNumber) {
      setTargetInput(String(detectedPullRequestNumber))
    }
  }, [detectedPullRequestNumber])

  const parsedRepository = parseGitHubRepositoryInput(repositoryInput)
  const parsedTarget = parseGitHubAwaitTargetInput(targetInput)
  const targetIssue = describeGitHubAwaitTargetInputIssue(
    targetInput,
    sourceKind,
  )
  const canCreate = hasSession
    && hasWorkspace
    && !!parsedRepository
    && !!parsedTarget
    && !targetIssue
    && (sourceKind === 'github-ci' || parsedTarget.kind === 'pull-request')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canCreate || !parsedRepository || !parsedTarget) {
      return
    }
    onCreate({
      sourceKind,
      reviewMode,
      repository: parsedRepository,
      target: parsedTarget,
    })
  }

  const statusText = !hasWorkspace
    ? 'Select a workspace-backed session to create awaits.'
    : repositoryDetectionStatus === 'loading'
      ? 'Reading git remotes...'
      : detectedRepository
        ? `Detected ${detectedRepository.fullName} from ${detectedRepository.remoteName}.`
        : repositoryDetectionStatus === 'error'
          ? 'Git remotes are unavailable; enter a GitHub repo manually.'
          : 'Enter a GitHub repo manually. SSH and HTTPS remotes are supported.'
  const TargetIcon = parsedTarget?.kind === 'pull-request'
    ? GitPullRequestIcon
    : GitCommitHorizontalIcon

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-[22rem] space-y-3 rounded-lg border border-border/70 bg-muted/35 p-2.5"
      data-testid="github-await-composer"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          <GitHubIcon className="text-foreground/80" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {sourceKind === 'github-ci' ? 'GitHub checks' : 'GitHub review'}
            </span>
            {detectedRepository && (
              <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                <WandSparklesIcon className="size-2.5" aria-hidden />
                Detected
              </span>
            )}
          </div>
          <p className="mt-0.5 text-pretty text-[11px] leading-4 text-muted-foreground">
            {statusText}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Await
          </div>
          <ToggleGroup
            type="single"
            value={sourceKind}
            onValueChange={(value) => {
              if (value) {
                setSourceKind(value as GitHubAwaitSourceKind)
              }
            }}
            variant="outline"
            size="sm"
            className="grid w-full grid-cols-2 rounded-md"
            aria-label="GitHub await source"
          >
            <ToggleGroupItem
              value="github-ci"
              aria-label="GitHub checks"
              className="h-7 gap-1 rounded-l-md px-2 text-xs"
            >
              <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
                <circle cx="8" cy="8" r="7" fill="currentColor" />
                <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Checks
            </ToggleGroupItem>
            <ToggleGroupItem
              value="github-review"
              aria-label="GitHub review"
              className="h-7 gap-1 rounded-r-md px-2 text-xs"
            >
              <MessageSquareCheckIcon className="size-3" aria-hidden />
              Review
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="min-w-0 space-y-1">
          <label
            htmlFor={repositoryInputId}
            className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70"
          >
            Repository
          </label>
          <Input
            id={repositoryInputId}
            value={repositoryInput}
            onChange={(event) => {
              repositoryEditedRef.current = true
              setRepositoryInput(event.target.value)
            }}
            placeholder="owner/repo"
            className="h-7 rounded-md text-xs"
            aria-label="GitHub repository"
          />
        </div>
      </div>

      <div className="min-w-0 space-y-1">
        <label
          htmlFor={targetInputId}
          className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70"
        >
          {sourceKind === 'github-ci' ? 'PR, commit, or check run' : 'Pull request'}
        </label>
        <div className="relative">
          <TargetIcon
            className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/70"
            aria-hidden
          />
          <Input
            id={targetInputId}
            value={targetInput}
            onChange={(event) => {
              targetEditedRef.current = true
              setTargetInput(event.target.value)
            }}
            inputMode="text"
            placeholder={sourceKind === 'github-ci'
              ? '123, commit sha/ref, or runs URL'
              : '123'}
            className="h-7 rounded-md pl-7 font-mono text-xs tabular-nums"
            aria-label={sourceKind === 'github-ci'
              ? 'GitHub pull request number, commit SHA/ref, or check run URL'
              : 'GitHub pull request number'}
            aria-invalid={targetIssue ? true : undefined}
          />
        </div>
        {targetIssue && (
          <p className="text-[11px] leading-4 text-destructive">{targetIssue}</p>
        )}
      </div>

      {sourceKind === 'github-review' && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Review signal
          </div>
          <Select
            value={reviewMode}
            onValueChange={value => setReviewMode(value as GitHubReviewMode)}
          >
            <SelectTrigger
              size="sm"
              className="h-7 w-full rounded-md text-xs"
              aria-label="GitHub review signal"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="changes-requested">Changes requested</SelectItem>
              <SelectItem value="reviewed">Any review</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <Button
        type="submit"
        size="sm"
        className="h-7 w-full rounded-md text-xs"
        disabled={!canCreate || isCreating}
      >
        {isCreating
          ? <Spinner className="size-3" aria-hidden />
          : <PlusIcon className="size-3" aria-hidden />}
        {sourceKind === 'github-ci' ? 'Wait for checks' : 'Wait for review'}
      </Button>
    </form>
  )
}
