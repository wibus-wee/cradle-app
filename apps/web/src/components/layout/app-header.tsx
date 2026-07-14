import {
  GlobeLine as GlobeIcon,
  LayoutBottomLine as PanelBottomIcon,
  LayoutLeftbarCloseLine as PanelLeftCloseIcon,
  LayoutLeftbarOpenLine as PanelLeftOpenIcon,
  LayoutRightLine as PanelRightIcon,
} from '@mingcute/react'
import { m } from 'motion/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { CHROME_COLLAPSED_SIDEBAR_WIDTH } from '~/components/layout/layout-responsive'
import { useChatSessionLayoutRecord } from '~/components/layout/use-layout-query-records'
import { Button } from '~/components/ui/button'
import { ResourcesPopover } from '~/features/devtool/resources/resources-popover'
import { SessionExecutionChrome } from '~/features/remote-hosts/session-execution-chrome'
import { SessionIsolationChrome } from '~/features/session/session-isolation-chrome'
import { SessionPullRequestChrome } from '~/features/session/session-pull-request-chrome'
import { WorkHeaderChrome } from '~/features/work/work-header-chrome'
import { cn } from '~/lib/cn'
import { isTearoffWindow, windowControlsSafeArea } from '~/lib/electron'
import { useActiveSurface } from '~/navigation/active-surface'
import { SurfaceBar } from '~/navigation/surface-bar'
import { chatSessionIdForSurface, workIdForSurface } from '~/navigation/surface-identity'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

interface AppHeaderProps {
  hasAside?: boolean
  hasBrowserPanel?: boolean
  hasPanel?: boolean
  browserPanelOwnerId?: string | null
  browserPanelOpen?: boolean
  sessionScoped?: boolean
  headerActions?: React.ReactNode
  sidebarInSheet?: boolean
  sidebarSheetOpen?: boolean
  onOpenSidebarSheet?: () => void
  onToggleSidebarSheet?: () => void
}

export function AppHeader({
  hasAside = false,
  hasBrowserPanel = false,
  hasPanel = false,
  browserPanelOwnerId = null,
  browserPanelOpen = false,
  sessionScoped = false,
  headerActions,
  sidebarInSheet = false,
  sidebarSheetOpen = false,
  onOpenSidebarSheet,
  onToggleSidebarSheet,
}: AppHeaderProps) {
  'use no memo'
  const { t } = useTranslation('chrome')
  const { t: tWorkspace } = useTranslation('workspace')
  const bottomPanelOpen = useLayoutStore(s => s.bottomPanelOpen)
  const asideOpen = useLayoutStore(s => s.asideOpen)
  const toggleBottomPanel = useLayoutStore(s => s.toggleBottomPanel)
  const toggleAside = useLayoutStore(s => s.toggleAside)
  const sidebarCollapsed = useLayoutStore(s => s.sidebarCollapsed)
  const toggleSidebar = useLayoutStore(s => s.toggleSidebar)
  const toggleBrowserPanel = useBrowserPanelStore(s => s.toggleDock)
  const activeSurface = useActiveSurface()
  const activeWorkId = workIdForSurface(activeSurface)
  const isSettingsActive = activeSurface?.kind === 'settings'
  const isDrillIn = isSettingsActive
  const sidebarToggleLabel = sidebarInSheet
    ? sidebarSheetOpen
      ? t('header.action.closeSidebar')
      : t('header.action.openSidebar')
    : sidebarCollapsed
      ? t('header.action.expandSidebar')
      : t('header.action.collapseSidebar')
  const reserveLeftWindowControls = windowControlsSafeArea.side === 'left'
    && windowControlsSafeArea.width > 0
    && (isTearoffWindow || sidebarInSheet)
  const reserveRightWindowControls = windowControlsSafeArea.side === 'right'
    && windowControlsSafeArea.width > 0
  const collapsedSidebarWindowControlsOffset = !sidebarInSheet
    && sidebarCollapsed
    && windowControlsSafeArea.side === 'left'
    ? Math.max(0, windowControlsSafeArea.width - CHROME_COLLAPSED_SIDEBAR_WIDTH - 2)
    : 0
  const asidePresentationOpen = asideOpen
  // In a tear-off window the surface is router-driven (navigated to the torn-off
  // route), so derive the chat session id from the active surface rather than
  // from a window env flag.
  const scopedSessionId = sessionScoped ? chatSessionIdForSurface(activeSurface) : null
  const scopedSessionLayout = useChatSessionLayoutRecord(scopedSessionId)
  const activeChatTitle = scopedSessionId && activeSurface?.kind === 'chat' ? activeSurface.title : null
  const sessionScopedTitle = scopedSessionLayout?.sessionTitle || activeChatTitle || tWorkspace('session.fallbackTitle')

  const handleSidebarToggle = useCallback(() => {
    if (sidebarInSheet) {
      if (onToggleSidebarSheet) {
        onToggleSidebarSheet()
        return
      }
      onOpenSidebarSheet?.()
      return
    }

    toggleSidebar()
  }, [onOpenSidebarSheet, onToggleSidebarSheet, sidebarInSheet, toggleSidebar])

  const handleAsideToggle = useCallback(() => {
    toggleAside()
  }, [toggleAside])

  return (
    <div
      className="relative flex h-11 shrink-0 items-center bg-sidebar pe-1 pl-1 mt-1 mb-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {reserveLeftWindowControls && (
        <div
          aria-hidden="true"
          className="h-full shrink-0"
          style={{ width: windowControlsSafeArea.width }}
        />
      )}

      {/* Left: sidebar toggle (hidden in drill-in modes where sidebar is forced open) */}
      {(!isDrillIn || sidebarInSheet) && !isTearoffWindow && (
        <m.div
          initial={false}
          animate={{ marginLeft: collapsedSidebarWindowControlsOffset }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden flex items-center"
        >
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('shrink-0 text-muted-foreground', sidebarInSheet && sidebarSheetOpen && 'text-foreground')}
            onClick={handleSidebarToggle}
            aria-label={sidebarToggleLabel}
            aria-pressed={sidebarInSheet ? sidebarSheetOpen : !sidebarCollapsed}
            title={sidebarToggleLabel}
            data-chrome-side-sheet-trigger={sidebarInSheet ? 'left' : undefined}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {(sidebarInSheet && !sidebarSheetOpen) || (!sidebarInSheet && sidebarCollapsed)
              ? <PanelLeftOpenIcon aria-hidden="true" />
              : <PanelLeftCloseIcon aria-hidden="true" />}
          </Button>
        </m.div>
      )}

      {/* Surface bar */}
      <div className="flex-1 min-w-0 ml-0.5 mr-1 h-full" style={{ WebkitAppRegion: isTearoffWindow ? 'drag' : 'no-drag' } as React.CSSProperties}>
        {sessionScoped
          ? (
            <div className="flex h-full min-w-0 items-center gap-2">
              <div
                className="min-w-0 truncate px-2 text-[13px] font-medium text-foreground"
                title={sessionScopedTitle}
              >
                {sessionScopedTitle}
              </div>
              {scopedSessionId && (
                <>
                  <SessionExecutionChrome sessionId={scopedSessionId} />
                  <SessionIsolationChrome
                    sessionId={scopedSessionId}
                    workspaceId={scopedSessionLayout?.workspaceId ?? null}
                  />
                  <SessionPullRequestChrome sessionId={scopedSessionId} />
                </>
              )}
            </div>
            )
          : (
            <SurfaceBar
              className="h-full"
            />
            )}
      </div>

      {/* Right: panel toggles */}
      <div className="ml-auto flex shrink-0 items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {headerActions}
        {activeWorkId && <WorkHeaderChrome workId={activeWorkId} />}
        <ResourcesPopover />
        {!isSettingsActive && hasBrowserPanel && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', browserPanelOpen && 'text-foreground')}
            onClick={() => toggleBrowserPanel(browserPanelOwnerId)}
            aria-label={t('header.action.toggleBrowserPanel')}
            aria-pressed={browserPanelOpen}
            title={t('header.action.toggleBrowserPanel')}
            data-testid="app-header-browser-toggle"
          >
            <GlobeIcon aria-hidden="true" />
          </Button>
        )}
        {!isSettingsActive && hasPanel && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', bottomPanelOpen && 'text-foreground')}
            onClick={toggleBottomPanel}
            aria-label={t('header.action.toggleBottomPanel')}
            aria-pressed={bottomPanelOpen}
            title={t('header.action.toggleBottomPanel')}
            data-testid="app-header-panel-toggle"
          >
            <PanelBottomIcon aria-hidden="true" />
          </Button>
        )}
        {!isSettingsActive && hasAside && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', asidePresentationOpen && 'text-foreground')}
            onClick={handleAsideToggle}
            aria-label={t('header.action.toggleRightPanel')}
            aria-pressed={asidePresentationOpen}
            title={t('header.action.toggleRightPanel')}
            data-testid="app-header-aside-toggle"
          >
            <PanelRightIcon aria-hidden="true" />
          </Button>
        )}
        {reserveRightWindowControls && (
          <div
            aria-hidden="true"
            className="h-full shrink-0"
            style={{ width: windowControlsSafeArea.width }}
          />
        )}
      </div>
    </div>
  )
}
