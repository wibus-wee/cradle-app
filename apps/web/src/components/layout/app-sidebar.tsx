import { GiftLine as GiftIcon } from '@mingcute/react'
import { m } from 'motion/react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AppNavigationControls } from '~/components/layout/app-navigation-controls'
import { ChromeSideSheet } from '~/components/layout/chrome-side-sheet'
import { CHROME_COLLAPSED_SIDEBAR_WIDTH } from '~/components/layout/layout-responsive'
import { ResizeHandle } from '~/components/layout/resize-handle'
import { SidebarUpdateButton } from '~/components/layout/sidebar-update-button'
import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { openWhatsNewDialog, usePendingAnnouncement } from '~/features/changelog/whats-new-store'
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
        className="relative flex flex-col flex-1 overflow-hidden"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <m.div
          className={cn(
            'absolute inset-0 flex flex-col overflow-hidden',
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
            'absolute inset-0 flex flex-col overflow-hidden',
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
      <SidebarWhatsNewButton collapsed={collapsed} />
      <SidebarUpdateButton collapsed={collapsed} />
    </>
  )
})
AppSidebarContent.displayName = 'AppSidebarContent'

function SidebarWhatsNewButton({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation('chrome')
  const announcement = usePendingAnnouncement()

  return (
    <TooltipProvider delayDuration={collapsed ? 0 : 500}>
      <div className="shrink-0 px-2 pb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size={collapsed ? 'icon-sm' : 'sm'}
              onClick={() => openWhatsNewDialog()}
              className={cn(
                'relative w-full justify-start gap-2 overflow-hidden text-sidebar-foreground/75 hover:bg-fill/80 hover:text-sidebar-foreground',
                'active:scale-[0.96]',
                collapsed && 'pl-1.5',
              )}
              aria-label={t('whatsNew.eyebrow')}
              data-testid="sidebar-whats-new-button"
            >
              <span className="relative flex size-4 shrink-0 items-center justify-center">
                <GiftIcon className="size-3.5" aria-hidden="true" />
                {announcement && (
                  <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-info ring-2 ring-sidebar" />
                )}
              </span>
              <span className={cn('min-w-0 flex-1 truncate text-left text-[12px]', collapsed && 'sr-only')}>
                {t('whatsNew.eyebrow')}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} className="mb-1 max-w-72 flex-col items-start gap-1 p-2.5">
            <span className="font-medium">{t('whatsNew.eyebrow')}</span>
            {announcement && (
              <span className="font-mono text-[11px] tabular-nums text-background/70">
                {announcement.version}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}

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
        className="flex flex-col shrink-0 bg-sidebar text-sidebar-foreground overflow-hidden"
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
