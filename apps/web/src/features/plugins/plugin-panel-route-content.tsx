import { createElement, useEffect } from 'react'

import { usePluginStore } from '~/lib/plugin-store'
import { useSurfaceActive } from '~/navigation/surface-activity-context'
import { useSurfaceStore } from '~/navigation/surface-store'

export function PluginPanelRouteContent({
  routeSegment,
  localId,
}: {
  routeSegment: string
  localId: string
}) {
  const isActive = useSurfaceActive()
  const updateSurfaceTitle = useSurfaceStore(state => state.updateSurfaceTitle)
  const panels = usePluginStore(s => s.panels)
  const panel = panels.find(item => item.routeSegment === routeSegment && item.localId === localId)

  useEffect(() => {
    updateSurfaceTitle(`plugin:${routeSegment}:${localId}`, panel?.title ?? 'Plugin')
  }, [localId, panel?.title, routeSegment, updateSurfaceTitle])

  if (!panel) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Panel not found:
        {' '}
        {`${routeSegment}/${localId}`}
      </div>
    )
  }

  return (
    <div className="h-full min-h-0" data-testid={`plugin-panel-${localId}`}>
      {createElement(panel.component, { isActive })}
    </div>
  )
}
