import { DownloadLine as DownloadIcon, SparklesLine as SparklesIcon } from '@mingcute/react'
import { m } from 'motion/react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AppNavigationControls } from '~/components/layout/app-navigation-controls'
import { ChromeSideSheet } from '~/components/layout/chrome-side-sheet'
import { CHROME_COLLAPSED_SIDEBAR_WIDTH } from '~/components/layout/layout-responsive'
import { ResizeHandle } from '~/components/layout/resize-handle'
import { Button } from '~/components/ui/button'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { isActiveDownload } from '~/features/download-center/types'
import { useDownloadCenterOwner } from '~/features/download-center/use-download-center'
import { SettingsSidebar } from '~/features/settings/settings-sidebar'
import { WorkspaceSidebar } from '~/features/workspace'
import { useShortcut } from '~/hooks/use-shortcut'
import { cn } from '~/lib/cn'
import type { DesktopUpdateStatus } from '~/lib/electron'
import { isElectron, nativeIpc, subscribeDesktopUpdateStatus } from '~/lib/electron'
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

const EMPTY_UPDATE_STATUS: DesktopUpdateStatus = {
  unsupported: true,
  currentVersion: '0.0.0',
  isCheckingForUpdates: false,
  isPreparingUpdate: false,
  updateDownloaded: false,
  updateInfo: null,
  errorMessage: null,
}

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
      <SidebarUpdateButton collapsed={collapsed} />
    </>
  )
})
AppSidebarContent.displayName = 'AppSidebarContent'

function SidebarUpdateButton({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation('chrome')
  const [status, setStatus] = useState<DesktopUpdateStatus>(EMPTY_UPDATE_STATUS)
  const downloadTasks = useDownloadCenterOwner({ namespace: 'desktop-update' })
  const notifiedVersionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isElectron || !nativeIpc) {
      return undefined
    }

    let mounted = true
    void nativeIpc.desktopUpdate.getStatus().then((nextStatus) => {
      if (mounted) {
        setStatus(nextStatus)
      }
    }).catch(() => {})

    const unsubscribe = subscribeDesktopUpdateStatus((nextStatus) => {
      setStatus(nextStatus)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const version = status.updateInfo?.version ?? null
    if (!version || notifiedVersionRef.current === version) {
      return
    }

    notifiedVersionRef.current = version
    toastManager.add({
      type: 'info',
      title: t('update.toast.availableTitle', { version }),
      description: t('update.toast.availableDescription'),
    })
  }, [status.updateInfo?.version, t])

  const updateDownload = downloadTasks.find(task => task.scope === 'desktop'
    && task.owner.namespace === 'desktop-update'
    && (task.owner.resourceType === 'macos-update' || task.owner.resourceType === 'windows-update')
    && isActiveDownload(task))
  const hasUpdateNotice = !!status.updateInfo || !!updateDownload || status.isPreparingUpdate || status.updateDownloaded

  if (!isElectron || !hasUpdateNotice) {
    return null
  }

  const label = status.unsupported
    ? t('update.status.unavailable')
    : status.isCheckingForUpdates
      ? t('update.status.checking')
      : updateDownload
        ? t('update.status.downloading', { progress: updateDownload.totalBytes && updateDownload.totalBytes > 0 ? Math.round((updateDownload.transferredBytes / updateDownload.totalBytes) * 100) : '—' })
        : status.isPreparingUpdate
          ? t('update.status.preparing')
          : status.updateDownloaded
            ? t('update.status.downloaded')
            : status.updateInfo
              ? t('update.status.available', { version: status.updateInfo.version })
              : t('update.status.current')

  const Icon = status.updateDownloaded || updateDownload || status.isPreparingUpdate ? DownloadIcon : SparklesIcon

  return (
    <TooltipProvider delayDuration={collapsed ? 0 : 500}>
      <div className="shrink-0 px-2 pb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size={collapsed ? 'icon-sm' : 'sm'}
              onClick={() => openSettingsSection('desktop')}
              className={cn(
                'relative w-full justify-start gap-2 overflow-hidden text-sidebar-foreground/75 hover:bg-fill/80 hover:text-sidebar-foreground',
                'active:scale-[0.96]',
                collapsed && 'pl-1.5',
                status.updateInfo && 'bg-info/10 text-info hover:bg-info/15 hover:text-info',
              )}
              aria-label={label}
              data-testid="sidebar-update-button"
            >
              <span className="relative flex size-4 shrink-0 items-center justify-center">
                <Icon className="size-3.5" aria-hidden="true" />
                {status.updateInfo && (
                  <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-info ring-2 ring-sidebar" />
                )}
              </span>
              <span className={cn('min-w-0 flex-1 truncate text-left text-[12px]', collapsed && 'sr-only')}>
                {t('update.button')}
              </span>
              <span className={cn(
                'shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground',
                collapsed && 'sr-only',
              )}
              >
                {status.updateInfo?.version ?? status.currentVersion}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} className="max-w-72 flex-col items-start gap-1.5 p-2.5 mb-1">
            <div className="flex w-full items-center justify-between gap-3">
              <span className="font-medium">{t('update.tooltip.title')}</span>
              <span className="font-mono text-[11px] tabular-nums text-background/70">
                {status.currentVersion}
              </span>
            </div>
            <div className="text-[11px] text-background/70">
              {label}
            </div>
            {status.updateInfo && (
              <div className="font-mono text-[11px] tabular-nums text-background/80">
                {t('update.tooltip.available', { version: status.updateInfo.version })}
              </div>
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
