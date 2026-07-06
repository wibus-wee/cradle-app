import { MonitorLine as MonitorIcon, Refresh1Line as RefreshCwIcon } from '@mingcute/react'
import { useRouterState } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch } from '~/components/ui/switch'
import { isElectron } from '~/lib/electron'
import { getReactDiagnosticsApi } from '~/lib/react-diagnostics'

export function DevBottomBar() {
  const { t } = useTranslation('chrome')
  const reactDiagnostics = getReactDiagnosticsApi()
  const reactDiagnosticsEnabled = useSyncExternalStore(
    reactDiagnostics.subscribe,
    reactDiagnostics.readEnabled,
    reactDiagnostics.readEnabled,
  )
  const activeRouteHash = useRouterState({
    select: (state) => {
      const location = state.location as { href?: string, pathname: string }
      return location.href ?? location.pathname
    },
  })

  return (
    <footer className="flex h-7 shrink-0 items-center border-t border-border bg-sidebar px-2 font-mono text-[10px]">
      <span
        className="flex-1 truncate select-all text-muted-foreground"
        title={activeRouteHash}
      >
        {activeRouteHash}
      </span>

      <div className="flex items-center gap-0.5">
        <label
          className="flex h-6 items-center gap-1.5 rounded px-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          title={reactDiagnosticsEnabled
            ? t('dev.action.reactDiagnostics.disableTitle')
            : t('dev.action.reactDiagnostics.enableTitle')}
        >
          <span className="whitespace-nowrap">{t('dev.action.reactDiagnostics')}</span>
          <Switch
            size="sm"
            checked={reactDiagnosticsEnabled}
            onCheckedChange={reactDiagnostics.setEnabled}
            aria-label={t('dev.action.reactDiagnostics')}
          />
        </label>
        <button
          type="button"
          title={t('dev.action.openDevtools.title')}
          aria-label={t('dev.action.openDevtools')}
          onClick={() => {
            if (isElectron) {
              window.cradle?.ipc.invoke('window.openDevtool')
            }
            else {
              window.open('/#/devtool', '_blank')
            }
          }}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <MonitorIcon className="inline-block size-3.5" aria-hidden="true" />
          {t('dev.action.openDevtools')}
        </button>
        <button
          type="button"
          title={t('dev.action.hardReload.title')}
          aria-label={t('dev.action.hardReload')}
          onClick={() => {
            window.location.reload()
          }}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <RefreshCwIcon className="inline-block size-3.5" aria-hidden="true" />
          {t('dev.action.hardReload')}
        </button>
      </div>
    </footer>
  )
}
