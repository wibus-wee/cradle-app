import { Plugin2Line, Settings3Line, WarningLine } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'
import { usePluginStore } from '~/lib/plugin-store'
import { useActiveSurface } from '~/navigation/active-surface'
import { openPluginCenter, openPluginPanel } from '~/navigation/navigation-commands'

export function PluginsSidebar({ collapsed }: { collapsed?: boolean }) {
  const { t } = useTranslation('settings')
  const panels = usePluginStore(s => s.panels)
  const webLayerStates = usePluginStore(s => s.webLayerStates)
  const activeSurface = useActiveSurface()
  const ready = panels.length > 0
  const failedCount = Object.values(webLayerStates).filter(state => state.status === 'failed').length

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
        {t('plugins.sidebar.title')}
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
      {failedCount > 0 && (
        <button
          type="button"
          onClick={() => openPluginCenter()}
          data-testid="plugin-panel-activation-failed-link"
          className={cn(
            'flex h-7 items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm',
            'hover:bg-fill cursor-pointer text-amber-600 dark:text-amber-300',
          )}
        >
          <WarningLine className="size-3.5 shrink-0" />
          <span
            className={cn(
              'min-w-0 truncate text-xs',
              collapsed ? 'opacity-0' : 'opacity-100',
            )}
          >
            {t('plugins.sidebar.activationFailed', { count: failedCount })}
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={() => openPluginCenter()}
        data-testid="plugin-panel-manage-link"
        className={cn(
          'flex h-7 items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm',
          'hover:bg-fill cursor-pointer text-muted-foreground',
        )}
      >
        <Settings3Line className="size-3.5 shrink-0" />
        <span
          className={cn(
            'min-w-0 truncate text-xs',
            collapsed ? 'opacity-0' : 'opacity-100',
          )}
        >
          {t('plugins.sidebar.manage')}
        </span>
      </button>
    </div>
  )
}
