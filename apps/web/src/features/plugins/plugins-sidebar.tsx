import { Plugin2Line } from '@mingcute/react'

import { cn } from '~/lib/cn'
import { usePluginStore } from '~/lib/plugin-store'
import { useActiveSurface } from '~/navigation/active-surface'
import { openPluginPanel } from '~/navigation/navigation-commands'

export function PluginsSidebar({ collapsed }: { collapsed?: boolean }) {
  const panels = usePluginStore(s => s.panels)
  const activeSurface = useActiveSurface()
  const ready = panels.length > 0

  if (!ready) {
    return null
  }

  const activePluginPanelKey = activeSurface?.kind === 'plugin' && activeSurface.route.to === '/plugins/$routeSegment/$localId'
    ? `${activeSurface.route.params.routeSegment}/${activeSurface.route.params.localId}`
    : undefined

  return (
    <div
      className="flex flex-col px-2 pb-2"
      data-testid="plugins-sidebar"
      data-plugins-sidebar-ready={ready ? 'true' : 'false'}
    >
      <div
        className={cn(
          'px-2 py-1.5 text-[11px] font-medium text-muted-foreground select-none transition-opacity duration-[120ms]',
          collapsed ? 'opacity-0' : 'opacity-100',
        )}
      >
        Extensions
      </div>
      {panels.map(panel => (
        <button
          type="button"
          key={panel.id}
          onClick={() => openPluginPanel({ routeSegment: panel.routeSegment, localId: panel.localId })}
          data-testid={`plugin-panel-link-${panel.localId}`}
          className={cn(
            'flex h-7 items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm',
            'hover:bg-fill cursor-pointer',
            activePluginPanelKey === `${panel.routeSegment}/${panel.localId}` && 'bg-fill text-foreground',
            activePluginPanelKey !== `${panel.routeSegment}/${panel.localId}` && 'text-muted-foreground',
          )}
        >
          <Plugin2Line className="size-3.5 shrink-0" />
          <span
            className={cn(
              'min-w-0 truncate text-xs',
              collapsed ? 'opacity-0' : 'opacity-100',
            )}
          >
            {panel.title}
          </span>
        </button>
      ))}
    </div>
  )
}
