import { createElement, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { usePluginStore } from '~/lib/plugin-store'
import { openPluginCenter } from '~/navigation/navigation-commands'
import { useSurfaceActive } from '~/navigation/surface-activity-context'
import { useSurfaceStore } from '~/navigation/surface-store'

export function PluginPanelRouteContent({
  routeSegment,
  localId,
}: {
  routeSegment: string
  localId: string
}) {
  const { t } = useTranslation('settings')
  const isActive = useSurfaceActive()
  const updateSurfaceTitle = useSurfaceStore(state => state.updateSurfaceTitle)
  const panels = usePluginStore(s => s.panels)
  const panel = panels.find(item => item.routeSegment === routeSegment && item.localId === localId)

  useEffect(() => {
    updateSurfaceTitle(`plugin:${routeSegment}:${localId}`, panel?.title ?? t('plugins.panel.fallbackTitle'))
  }, [localId, panel?.title, routeSegment, t, updateSurfaceTitle])

  if (!panel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-[13px]">{t('plugins.panel.notFound', { id: `${routeSegment}/${localId}` })}</p>
        <Button variant="outline" size="sm" onClick={() => openPluginCenter()}>
          {t('plugins.panel.backToCenter')}
        </Button>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0" data-testid={`plugin-panel-${localId}`}>
      {createElement(panel.component, { isActive })}
    </div>
  )
}
