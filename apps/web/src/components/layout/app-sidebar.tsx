import { m } from 'motion/react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AppNavigationControls } from '~/components/layout/app-navigation-controls'
import { ChromeSideSheet } from '~/components/layout/chrome-side-sheet'
import { CHROME_COLLAPSED_SIDEBAR_WIDTH } from '~/components/layout/layout-responsive'
import { ResizeHandle } from '~/components/layout/resize-handle'
import { SidebarUpdateButton } from '~/components/layout/sidebar-update-button'
import { SettingsSidebar } from '~/features/settings/settings-sidebar'
import { WorkspaceSidebar } from '~/features/workspace'
import { useShortcut } from '~/hooks/use-shortcut'
import { cn } from '~/lib/cn'
import { useActiveSurface } from '~/navigation/active-surface'
import { closeSurfaceById, openSettingsSection } from '~/navigation/navigation-commands'
import { useLayoutStore } from '~/store/layout'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

const DRILL_TRANSITION = {
  type: 'spring',
  stiffness: 500,
  damping: 35,
  mass: 0.8,
} as const

const SIDEBAR_SPRING = { type: 'spring', stiffness: 600, damping: 40 } as const
const INSTANT = { duration: 0 } as const
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 400

interface AppSidebarContentProps {
  isSettings: boolean
  collapsed: boolean
  reserveTopChrome?: boolean
  settingsSection: string
  onSetSettingsSection: (section: string) => void
  onCloseSettings: () => void
}

const AppSidebarContent = memo(({
  isSettings,
  collapsed,
  reserveTopChrome = true,
  settingsSection,
  onSetSettingsSection,
  onCloseSettings,
}: AppSidebarContentProps) => {
  return (
    <>
      {reserveTopChrome && (
        <div
          className="flex h-11 shrink-0 items-center justify-end pr-2"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="mt-2">
            {!collapsed && <AppNavigationControls />}
          </div>
        </div>
      )}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <m.div
          className={cn(
            'absolute inset-0 flex min-h-0 flex-col overflow-hidden',
            isSettings ? 'pointer-events-auto' : 'pointer-events-none',
          )}
          data-testid="settings-sidebar-pane"
          data-sidebar-pane-active={isSettings ? 'true' : 'false'}
          initial={false}
          animate={isSettings
            ? { x: 0, opacity: 1, filter: 'blur(0px)' }
            : { x: 20, opacity: 0, filter: 'blur(4px)' }}
          transition={DRILL_TRANSITION}
          aria-hidden={isSettings ? undefined : 'true'}
          inert={isSettings ? undefined : true}
        >
          <SettingsSidebar
            activeSection={settingsSection}
            onSetSection={onSetSettingsSection}
            onClose={onCloseSettings}
          />
        </m.div>
        <m.div
          className={cn(
            'absolute inset-0 flex min-h-0 flex-col overflow-hidden',
            isSettings ? 'pointer-events-none' : 'pointer-events-auto',
          )}
          data-testid="workspace-sidebar-pane"
          data-sidebar-pane-active={isSettings ? 'false' : 'true'}
          initial={false}
          animate={isSettings
            ? { x: -20, opacity: 0, filter: 'blur(4px)' }
            : { x: 0, opacity: 1, filter: 'blur(0px)' }}
          transition={DRILL_TRANSITION}
          aria-hidden={isSettings ? 'true' : undefined}
          inert={isSettings ? true : undefined}
        >
          <WorkspaceSidebar collapsed={collapsed} />
        </m.div>
      </div>
      <SidebarUpdateButton collapsed={collapsed} />
    </>
  )
})
AppSidebarContent.displayName = 'AppSidebarContent'

function useAppSidebarContentController() {
  const settingsSection = useSettingsOverlayStore(s => s.settingsSection)
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)
  const activeSurface = useActiveSurface()
  const isSettings = activeSurface?.kind === 'settings'

  const closeSettings = useCallback(() => {
    closeSurfaceById('settings')
  }, [])

  const handleToggleSettings = useCallback(() => {
    if (isSettings) {
      closeSettings()
    }
    else {
      openSettingsSection(settingsSection)
    }
  }, [closeSettings, isSettings, settingsSection])

  const handleSetSettingsSection = useCallback((section: string) => {
    setSettingsSection(section)
    openSettingsSection(section, { replace: isSettings })
  }, [isSettings, setSettingsSection])

  useShortcut('toggle-settings', { meta: true, key: ',', allowInEditable: true }, handleToggleSettings)
  useShortcut('exit-settings', { meta: true, key: 'Escape', allowInEditable: true }, closeSettings, isSettings)

  return {
    closeSettings,
    isSettings,
    setSettingsSection: handleSetSettingsSection,
    settingsSection,
  }
}

export function AppSidebar() {
  'use no memo'
  const sidebarWidth = useLayoutStore(s => s.sidebarWidth)
  const setSidebarWidth = useLayoutStore(s => s.setSidebarWidth)
  const sidebarCollapsed = useLayoutStore(s => s.sidebarCollapsed)
  const toggleSidebar = useLayoutStore(s => s.toggleSidebar)
  const {
    closeSettings,
    isSettings,
    setSettingsSection,
    settingsSection,
  } = useAppSidebarContentController()
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  useShortcut('toggle-sidebar', { meta: true, key: 'b', allowInEditable: true }, toggleSidebar)

  // Settings drill-in forces sidebar open; main mode respects user's collapse preference.
  const collapsed = sidebarCollapsed && !isSettings
  const currentWidth = collapsed ? CHROME_COLLAPSED_SIDEBAR_WIDTH : dragWidth ?? sidebarWidth

  const handleSidebarResize = useCallback((width: number) => {
    setDragWidth(width)
  }, [])

  const handleSidebarResizeEnd = useCallback((width: number) => {
    setSidebarWidth(width)
    setDragWidth(null)
  }, [setSidebarWidth])

  return (
    <>
      <m.aside
        className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
        animate={{ width: currentWidth }}
        transition={dragWidth === null ? SIDEBAR_SPRING : INSTANT}
        style={{ width: currentWidth }}
        data-testid="app-sidebar"
        data-sidebar-mode={isSettings ? 'settings' : 'main'}
        data-sidebar-collapsed={collapsed ? 'true' : 'false'}
      >
        <AppSidebarContent
          isSettings={isSettings}
          collapsed={collapsed}
          settingsSection={settingsSection}
          onSetSettingsSection={setSettingsSection}
          onCloseSettings={closeSettings}
        />
      </m.aside>
      {!collapsed && (
        <ResizeHandle
          direction="horizontal"
          value={sidebarWidth}
          onChange={handleSidebarResize}
          onChangeEnd={handleSidebarResizeEnd}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          className="bg-sidebar"
        />
      )}
    </>
  )
}

interface AppSidebarSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AppSidebarSheet({ open, onOpenChange }: AppSidebarSheetProps) {
  'use no memo'
  const { t } = useTranslation('chrome')
  const {
    closeSettings,
    isSettings,
    setSettingsSection,
    settingsSection,
  } = useAppSidebarContentController()

  const toggleSidebarSheet = useCallback(() => {
    onOpenChange(!open)
  }, [onOpenChange, open])

  useShortcut('toggle-sidebar', { meta: true, key: 'b', allowInEditable: true }, toggleSidebarSheet)

  return (
    <ChromeSideSheet
      open={open}
      onOpenChange={onOpenChange}
      side="left"
      title={t('chromeSheet.sidebar.title')}
      closeLabel={t('chromeSheet.action.close')}
      className="w-[min(20rem,calc(100vw-2rem))]"
    >
      <AppSidebarContent
        isSettings={isSettings}
        collapsed={false}
        reserveTopChrome={false}
        settingsSection={settingsSection}
        onSetSettingsSection={setSettingsSection}
        onCloseSettings={closeSettings}
      />
    </ChromeSideSheet>
  )
}
