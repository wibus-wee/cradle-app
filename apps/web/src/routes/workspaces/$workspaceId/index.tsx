import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceDetailRouteContent } from '~/features/workspace-detail/workspace-detail-route-content'

export const Route = createFileRoute('/workspaces/$workspaceId/')({
  component: WorkspaceDetailRoute,
})

function WorkspaceDetailRoute() {
  const { workspaceId } = Route.useParams()
  return <WorkspaceDetailRouteContent workspaceId={workspaceId} />
}
