import {
  AlertLine as AlertCircleIcon,
  BoxLine as BoxIcon,
  ClipboardLine as ClipboardIcon,
  GitBranchLine as GitBranchIcon,
  GitCommitLine as GitCommitIcon,
  GitCompareLine as FileDiffIcon,
  TargetLine as TargetIcon,
} from '@mingcute/react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { postWorkspacesByWorkspaceIdDiffReviewsLocalBranchCompareMutation } from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { useRepairSessionIsolation } from '~/features/session/use-session-isolation'
import { apiErrorMessage } from '~/lib/api-error'
import { cn } from '~/lib/cn'
import { openWorkspaceDiffs } from '~/navigation/navigation-commands'

import { useWorkDetail } from './use-work'

type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>

// The aside is a calm reference view: objective, execution state, and handoff.
// Delivery actions (publish, mark ready) live in the header chrome so Work
// reads like a normal session - this panel never competes as a control center.
// Hierarchy is carried by icons + contrast, not boxes: the objective's larger
// darker text leads, execution is a scannable icon-row list, handoff recedes.
export function WorkAsidePanel({ workId }: { workId: string }) {
  const { t } = useTranslation('work')
  const workQuery = useWorkDetail(workId)
  const reviewChanges = useMutation(postWorkspacesByWorkspaceIdDiffReviewsLocalBranchCompareMutation())
  const repair = useRepairSessionIsolation()
  const detail = workQuery.data

  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center" data-testid="work-aside-panel">
        <Spinner className="size-4" />
      </div>
    )
  }

  const canReviewChanges = detail.primaryThread.workspaceId !== null
    && detail.readiness.baseRef !== null
    && detail.readiness.branch !== null

  const handleReviewChanges = async () => {
    const baseRef = detail.readiness.baseRef
    const headRef = detail.readiness.branch
    const workspaceId = detail.primaryThread.workspaceId
    if (!baseRef || !headRef || !workspaceId) {
      return
    }
    try {
      const review = await reviewChanges.mutateAsync({
        path: { workspaceId },
        body: { baseRef, headRef },
      })
      openWorkspaceDiffs({ workspaceId, reviewId: review.id })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('aside.reviewChangesFailed'),
        description: apiErrorMessage(error),
      })
    }
  }

  const handleRepair = async () => {
    try {
      await repair.mutateAsync({
        sessionId: detail.primaryThread.id,
        workspaceId: detail.primaryThread.workspaceId,
      })
      void workQuery.refetch()
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('aside.execution.unhealthy'),
        description: apiErrorMessage(error),
      })
    }
  }

  const hasHandoff = detail.work.handoffSummary || detail.work.handoffTestPlan

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-3" data-testid="work-aside-panel">
      <div className="flex flex-1 flex-col gap-4">
        {/* Objective - the goal. Its larger, darker text leads the panel over
            the execution rows and handoff notes below. */}
        <section className="space-y-1">
          <SectionHeader icon={TargetIcon} label={t('aside.objective')} />
          <p className={cn(
            'mt-1.5 whitespace-pre-wrap text-[13px] leading-5',
            detail.work.objective ? 'text-foreground/90' : 'text-muted-foreground/60',
          )}
          >
            {detail.work.objective || t('aside.objective.empty')}
          </p>
        </section>

        {/* Execution - scannable state. Each row leads with an icon so the
            worktree / changes / commits are distinguishable at a glance. */}
        <section className="space-y-2">
          <SectionHeader icon={BoxIcon} label={t('aside.execution')} />
          {detail.execution.worktreeHealth !== 'ok' && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-600 dark:text-amber-500">
              <AlertCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="flex-1">{t('aside.execution.unhealthy')}</span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={repair.isPending}
                onClick={() => void handleRepair()}
              >
                {repair.isPending ? <Spinner className="size-3" /> : t('new.tryAgain')}
              </Button>
            </div>
          )}
          <dl className="divide-y divide-border/60">
            <PropertyRow icon={GitBranchIcon} label={t('aside.managedWorktree')}>
              <span className="truncate font-mono">{detail.execution.worktreeBranch ?? detail.execution.worktreeId}</span>
            </PropertyRow>
            <PropertyRow icon={FileDiffIcon} label={t('aside.execution.changes')}>
              {detail.readiness.clean
                ? t('aside.clean')
                : t('aside.changedFiles', { count: detail.readiness.changedFiles })}
            </PropertyRow>
            <PropertyRow icon={GitCommitIcon} label={t('aside.execution.commits')}>
              <span className="tabular-nums">{t('aside.commitsAhead', { count: detail.readiness.commitsAhead })}</span>
            </PropertyRow>
          </dl>
          {canReviewChanges && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full justify-center gap-1.5"
              disabled={reviewChanges.isPending}
              onClick={() => void handleReviewChanges()}
            >
              {reviewChanges.isPending
                ? <Spinner className="size-3.5" />
                : <FileDiffIcon className="size-3.5" aria-hidden="true" />}
              {t('aside.reviewChanges')}
            </Button>
          )}
        </section>

        {/* Handoff - the agent's prepared summary. Subdued, reference-only. */}
        <section className="space-y-2">
          <SectionHeader icon={ClipboardIcon} label={t('aside.handoff')} />
          {hasHandoff
            ? (
                <div className="space-y-2 text-[12px] leading-5 text-muted-foreground">
                  {detail.work.handoffSummary && (
                    <p className="whitespace-pre-wrap text-foreground/80">{detail.work.handoffSummary}</p>
                  )}
                  {detail.work.handoffTestPlan && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-muted-foreground/80">{t('aside.handoff.testPlan')}</span>
                      <p className="whitespace-pre-wrap">{detail.work.handoffTestPlan}</p>
                    </div>
                  )}
                </div>
              )
            : <p className="text-[12px] leading-5 text-muted-foreground/60">{t('aside.handoff.empty')}</p>}
        </section>
      </div>
    </div>
  )
}

function SectionHeader({ icon: Icon, label }: { icon: IconType, label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="text-[11px] font-semibold text-foreground/80">{label}</span>
    </div>
  )
}

function PropertyRow({ icon: Icon, label, children }: { icon: IconType, label: string, children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <dt className="shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1.5 text-[11px] text-foreground/80">
        <Icon className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        {children}
      </dd>
    </div>
  )
}
