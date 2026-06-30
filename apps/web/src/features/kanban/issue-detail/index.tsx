import { useEffect } from 'react'

import { Skeleton } from '~/components/ui/skeleton'
import type { KanbanIssue } from '~/features/kanban/types'
import { useFeatureFlag } from '~/features/settings/use-app-preferences'
import { authorizeDangerousAction } from '~/lib/electron'

import { useDeleteIssue, useIssue, useMilestones, useStatuses, useUpdateIssue } from '../use-kanban'
import { ActivityTimeline } from './activity-timeline'
import { IssueDescription } from './issue-description'
import { IssueHeader } from './issue-header'
import { IssueTitle } from './issue-title'
import { MilestoneBanner } from './milestone-banner'
import { calculateMilestoneProgress } from './milestone-progress'
import { PropertiesSidebar } from './properties-sidebar'
import { SubIssuesList } from './sub-issues-list'

interface IssueDetailProps {
  issueId: string
  workspaceId: string
  issues: KanbanIssue[]
  issueOverride?: KanbanIssue | null
  readOnly?: boolean
  onOpenIssue: (id: string) => void
  onOpenMilestone?: (id: string) => void
  onBack: () => void
}

export function IssueDetail({
  issueId,
  workspaceId,
  issues,
  issueOverride,
  readOnly = false,
  onOpenIssue,
  onOpenMilestone,
  onBack,
}: IssueDetailProps) {
  const shouldLoadIssue = !issueOverride
  const { data: loadedIssue, isLoading, isError, error } = useIssue(issueId, shouldLoadIssue)
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const updateIssue = useUpdateIssue()
  const deleteIssue = useDeleteIssue()
  const issue = issueOverride ?? loadedIssue
  const localAuthForDangerousActions = useFeatureFlag('localAuthForDangerousActions')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        onBack()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onBack])

  const handleUpdate = (patch: Parameters<typeof updateIssue.mutate>[0]['patch']) => {
    if (readOnly) {
      return
    }
    updateIssue.mutate({ id: issueId, patch })
  }

  const handleDelete = async () => {
    if (readOnly) {
      return
    }
    const authorized = await authorizeDangerousAction({
      action: 'delete',
      resource: 'issue',
      label: issue?.title ?? issueId,
      enabled: localAuthForDangerousActions,
    })
    if (!authorized) {
      return
    }
    deleteIssue.mutate(issueId, {
      onSuccess: () => onBack(),
    })
  }

  const statusById = new Map(statuses.map(status => [status.id, status]))

  const subIssues = issue ? issues.filter(candidate => candidate.parentIssueId === issue.id) : []

  const completedSubIssueCount = subIssues.filter(
    subIssue => statusById.get(subIssue.statusId ?? '')?.category === 'completed',
  ).length

  const siblingIssues = (() => {
    if (!issue?.parentIssueId) {
      return []
    }
    return issues
      .filter(candidate => candidate.parentIssueId === issue.parentIssueId)
      .toSorted((left, right) => {
        const orderDelta = (left.order ?? 0) - (right.order ?? 0)
        if (orderDelta !== 0) {
          return orderDelta
        }
        return (left.createdAt ?? 0) - (right.createdAt ?? 0)
      })
  })()

  const siblingIndex = issue
    ? siblingIssues.findIndex(candidate => candidate.id === issue.id)
    : -1

  const parentIssue = issue?.parentIssueId
    ? issues.find(candidate => candidate.id === issue.parentIssueId)
    : undefined

  const currentMilestone = issue?.milestoneId
    ? milestones.find(milestone => milestone.id === issue.milestoneId)
    : undefined

  const milestoneProgress = calculateMilestoneProgress(
    issues,
    statuses,
    currentMilestone?.id ?? null,
  )

  const previousSiblingIssue = siblingIndex > 0 ? siblingIssues[siblingIndex - 1] : undefined
  const nextSiblingIssue
    = siblingIndex >= 0 && siblingIndex < siblingIssues.length - 1
      ? siblingIssues[siblingIndex + 1]
      : undefined

  if (!issueOverride && isError) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-[13px] text-destructive">
        {error instanceof Error ? error.message : 'Failed to load issue'}
      </div>
    )
  }

  if (!issueOverride && isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" data-testid="issue-detail-skeleton">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <Skeleton className="size-7 rounded" />
          <Skeleton className="h-4 w-14 rounded" />
          <Skeleton className="h-4 w-48 rounded" />
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 px-10 py-6 space-y-4">
            <Skeleton className="h-8 w-3/4 rounded-md" />
            <div className="space-y-2 mt-6">
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-5/6 rounded" />
              <Skeleton className="h-4 w-4/6 rounded" />
            </div>
          </div>
          <div className="w-70 shrink-0 px-3 py-6">
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        </div>
      </div>
    )
  }

  if (!issue) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        Issue not found
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="issue-detail-panel">
      <IssueHeader
        issue={issue}
        status={statuses.find(s => s.id === issue.statusId)}
        parentIssue={parentIssue}
        completedSubIssueCount={completedSubIssueCount}
        totalSubIssueCount={subIssues.length}
        siblingNumber={siblingIndex >= 0 ? siblingIndex + 1 : undefined}
        siblingCount={siblingIssues.length}
        previousSiblingIssue={previousSiblingIssue}
        nextSiblingIssue={nextSiblingIssue}
        onOpenIssue={onOpenIssue}
        onBack={onBack}
        onDelete={handleDelete}
        readOnly={readOnly}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto px-10 py-6">
          <div>
            <IssueTitle issue={issue} onUpdate={handleUpdate} readOnly={readOnly} />

            {currentMilestone && (
              <MilestoneBanner
                milestone={currentMilestone}
                progress={milestoneProgress}
                onOpenMilestone={onOpenMilestone}
              />
            )}

            <IssueDescription issue={issue} onUpdate={handleUpdate} readOnly={readOnly} />

            <div className="mt-8">
              <SubIssuesList
                issueId={issueId}
                workspaceId={workspaceId}
                statuses={statuses}
                onOpenIssue={onOpenIssue}
                readOnly={readOnly}
              />
            </div>

            <div className="mt-8">
              <ActivityTimeline issueId={issueId} workspaceId={workspaceId} readOnly={readOnly} />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-70 shrink-0 overflow-y-auto px-3 py-6">
          <PropertiesSidebar
            issue={issue}
            issues={issues}
            statuses={statuses}
            milestones={milestones}
            onUpdate={handleUpdate}
            readOnly={readOnly}
          />
        </div>
      </div>
    </div>
  )
}
