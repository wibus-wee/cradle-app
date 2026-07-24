import {
  AlertLine as AlertCircleIcon,
  BoxLine as BoxIcon,
  ClipboardLine as ClipboardIcon,
  GitBranchLine as GitBranchIcon,
  GitCommitLine as GitCommitIcon,
  GitCompareLine as FileDiffIcon,
  TargetLine as TargetIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

import type { WorkDetail } from './use-work'
import { WorkAsidePropertyRow } from './work-aside-property-row'
import { WorkAsideSectionHeader } from './work-aside-section-header'

interface WorkAsidePanelLabels {
  objective: string
  objectiveEmpty: string
  execution: string
  executionUnhealthy: string
  tryAgain: string
  managedWorktree: string
  changes: string
  clean: string
  changedFiles: string
  commits: string
  commitsAhead: string
  reviewChanges: string
  handoff: string
  handoffTestPlan: string
  handoffEmpty: string
}

interface WorkAsidePanelViewProps {
  detail: WorkDetail | null
  labels: WorkAsidePanelLabels
  canReviewChanges?: boolean
  isReviewingChanges?: boolean
  isRepairing?: boolean
  onReviewChanges: () => void
  onRepair: () => void
}

export function WorkAsidePanelView({
  detail,
  labels,
  canReviewChanges = false,
  isReviewingChanges = false,
  isRepairing = false,
  onReviewChanges,
  onRepair,
}: WorkAsidePanelViewProps) {
  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center" data-testid="work-aside-panel">
        <Spinner className="size-4" />
      </div>
    )
  }

  const hasHandoff = detail.work.handoffSummary || detail.work.handoffTestPlan

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-3" data-testid="work-aside-panel">
      <div className="flex flex-1 flex-col gap-4">
        <section className="space-y-1">
          <WorkAsideSectionHeader icon={TargetIcon} label={labels.objective} />
          <p
            className={cn(
              'mt-1.5 whitespace-pre-wrap text-[13px] leading-5',
              detail.work.objective ? 'text-foreground/90' : 'text-muted-foreground/60',
            )}
          >
            {detail.work.objective || labels.objectiveEmpty}
          </p>
        </section>

        <section className="space-y-2">
          <WorkAsideSectionHeader icon={BoxIcon} label={labels.execution} />
          {detail.execution.worktreeHealth !== 'ok' && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-500">
              <AlertCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="flex-1">{labels.executionUnhealthy}</span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={isRepairing}
                onClick={onRepair}
              >
                {isRepairing ? <Spinner className="size-3" /> : labels.tryAgain}
              </Button>
            </div>
          )}
          <dl className="divide-y divide-border/60">
            <WorkAsidePropertyRow icon={GitBranchIcon} label={labels.managedWorktree}>
              <span className="truncate font-mono">
                {detail.execution.worktreeBranch ?? detail.execution.worktreeId}
              </span>
            </WorkAsidePropertyRow>
            <WorkAsidePropertyRow icon={FileDiffIcon} label={labels.changes}>
              {detail.readiness.clean ? labels.clean : labels.changedFiles}
            </WorkAsidePropertyRow>
            <WorkAsidePropertyRow icon={GitCommitIcon} label={labels.commits}>
              <span className="tabular-nums">{labels.commitsAhead}</span>
            </WorkAsidePropertyRow>
          </dl>
          {canReviewChanges && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full justify-center gap-1.5"
              disabled={isReviewingChanges}
              onClick={onReviewChanges}
            >
              {isReviewingChanges
                ? <Spinner className="size-3.5" />
                : <FileDiffIcon className="size-3.5" aria-hidden="true" />}
              {labels.reviewChanges}
            </Button>
          )}
        </section>

        <section className="space-y-2">
          <WorkAsideSectionHeader icon={ClipboardIcon} label={labels.handoff} />
          {hasHandoff
            ? (
                <div className="space-y-2 text-[12px] leading-5 text-muted-foreground">
                  {detail.work.handoffSummary && (
                    <p className="whitespace-pre-wrap text-foreground/80">{detail.work.handoffSummary}</p>
                  )}
                  {detail.work.handoffTestPlan && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-muted-foreground/80">
                        {labels.handoffTestPlan}
                      </span>
                      <p className="whitespace-pre-wrap">{detail.work.handoffTestPlan}</p>
                    </div>
                  )}
                </div>
              )
            : <p className="text-[12px] leading-5 text-muted-foreground/60">{labels.handoffEmpty}</p>}
        </section>
      </div>
    </div>
  )
}
