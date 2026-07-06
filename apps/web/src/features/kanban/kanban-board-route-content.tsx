import { DashboardLine as LayoutDashboardIcon } from '@mingcute/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Spinner } from '~/components/ui/spinner'
import { useSurfaceStore } from '~/navigation/surface-store'
import { router } from '~/router'

import { KanbanView } from './index'
import { useBoard, useIssue } from './use-kanban'

export function KanbanBoardRouteContent({
  boardId,
  issue,
  milestoneId,
}: {
  boardId: string
  issue?: string
  milestoneId?: string
}) {
  const { t } = useTranslation('kanban')
  const updateSurfaceTitle = useSurfaceStore(state => state.updateSurfaceTitle)
  const { data: board, isLoading } = useBoard(boardId)
  const { data: issueRecord } = useIssue(issue ?? '')

  useEffect(() => {
    if (issue && issueRecord?.title) {
      updateSurfaceTitle(`kanban:${boardId}`, issueRecord.title)
      return
    }
    if (board?.name) {
      updateSurfaceTitle(`kanban:${boardId}`, board.name)
    }
  }, [board?.name, boardId, issue, issueRecord?.title, updateSurfaceTitle])

  const handleSelectIssue = (issueId: string | null) => {
    void router.navigate({
      to: '/kanban/$boardId',
      params: { boardId },
      search: {
        issue: issueId ?? undefined,
        milestoneId: undefined,
      },
    })
  }

  const handleOpenMilestone = (nextMilestoneId: string) => {
    void router.navigate({
      to: '/kanban/$boardId',
      params: { boardId },
      search: {
        issue: undefined,
        milestoneId: nextMilestoneId,
      },
    })
  }

  if (!boardId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <LayoutDashboardIcon className="size-8" />
        <p className="text-[12px]">{t('board.emptySelection')}</p>
      </div>
    )
  }

  if (isLoading || !board) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  return (
    <KanbanView
      boardId={boardId}
      workspaceId={board.workspaceId}
      selectedIssueId={issue}
      initialMilestoneId={milestoneId}
      onSelectIssue={handleSelectIssue}
      onOpenMilestone={handleOpenMilestone}
    />
  )
}
