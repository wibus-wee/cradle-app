import { createFileRoute } from '@tanstack/react-router'

import { PluginPanelRouteContent } from '~/features/plugins/plugin-panel-route-content'

export const Route = createFileRoute('/plugins/$routeSegment/$localId')({
  component: PluginPanelRoute,
})

function PluginPanelRoute() {
  const { routeSegment, localId } = Route.useParams()
  return <PluginPanelRouteContent routeSegment={routeSegment} localId={localId} />
}
