import { createFileRoute } from '@tanstack/react-router'

import { KanbanBoardRouteContent } from '~/features/kanban/kanban-board-route-content'

interface KanbanSearch {
  issue?: string
  milestoneId?: string
}

export const Route = createFileRoute('/kanban/$boardId')({
  validateSearch: (search: Record<string, unknown>): KanbanSearch => ({
    issue: typeof search.issue === 'string' ? search.issue : undefined,
    milestoneId: typeof search.milestoneId === 'string' ? search.milestoneId : undefined,
  }),
  component: KanbanBoardRoute,
})

function KanbanBoardRoute() {
  const { boardId } = Route.useParams()
  const { issue, milestoneId } = Route.useSearch()
  return <KanbanBoardRouteContent boardId={boardId} issue={issue} milestoneId={milestoneId} />
}
