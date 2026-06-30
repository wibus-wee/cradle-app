import { Outlet, useLocation, useNavigate, useRouterState } from '@tanstack/react-router'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useThemeClass } from '~/app-providers'
import { AppLayout } from '~/components/layout/app-layout'
import { AppSidebar, AppSidebarSheet } from '~/components/layout/app-sidebar'
import { useSidebarSheetMode } from '~/components/layout/layout-responsive'
import { useSyncLayoutSlotScope } from '~/components/layout/use-layout-slots'
import { WhatsNewTrigger } from '~/features/changelog/whats-new-trigger'
import { useDesktopTrayActionBridge } from '~/features/desktop-tray/use-desktop-tray-action-bridge'
import { CredentialSetupDialog } from '~/features/onboarding/credential-setup-dialog'
import { useOnboardingStore } from '~/features/onboarding/onboarding-store'
import { useGlobalSearchStore } from '~/features/search/global-search-store'
import { useKeyBindingsOverlayStore } from '~/features/shortcuts/key-bindings-overlay-store'
import { useUnreadSessionIds } from '~/features/workspace/use-session'
import { isWorkspaceFileShortcutScopeEvent } from '~/features/workspace/workspace-file-shortcuts'
import { isTearoffWindow, tearoffSurfaceRoute } from '~/lib/electron'
import { surfaceDraftFromRouterState, useActiveSurface } from '~/navigation/active-surface'
import { createRouteSurfaceSyncRouteKey, isRouteSurfaceSyncSuppressed } from '~/navigation/route-surface-sync-key'
import { SurfaceActivityProvider } from '~/navigation/surface-activity-context'
import { layoutSlotIdForRoute, layoutSlotIdForSurface } from '~/navigation/surface-identity'
import { installSurfaceResourceLifecycle } from '~/navigation/surface-resource-lifecycle'
import { useSurfaceStore } from '~/navigation/surface-store'
import { installTearoffSurfaceRestore } from '~/navigation/tearoff-surfaces'
import { chatSelectors, useChatStore } from '~/store/chat'

const loadGlobalSearchDialog = () =>
  import('~/features/search/global-search-dialog').then(module => ({
    default: module.GlobalSearchDialog,
  }))

const GlobalSearchDialog = lazy(loadGlobalSearchDialog)

const loadKeyBindingsOverlay = () =>
  import('~/features/shortcuts/key-bindings-overlay').then(module => ({
    default: module.KeyBindingsOverlay,
  }))

const KeyBindingsOverlay = lazy(loadKeyBindingsOverlay)

const StreamingChatRetentionHost = lazy(() =>
  import('~/features/chat/session/streaming-chat-retention-host').then(module => ({
    default: module.StreamingChatRetentionHost,
  })))

function isKeyBindingsOverlayShortcut(event: KeyboardEvent): boolean {
  const isMod = event.metaKey || event.ctrlKey
  const isSlash = event.key === '/' || event.code === 'Slash'
  return isMod && isSlash && !event.altKey && !event.shiftKey
}

function isKeyBindingsOverlayShortcutRelease(event: KeyboardEvent): boolean {
  return event.key === '/' || event.code === 'Slash' || event.key === 'Meta' || event.key === 'Control'
}

function syncDesktopAppBadgeUnreadCount(count: number): void {
  const promise = window.cradle?.desktopAppBadge?.setUnreadCount(count)
  void promise?.catch(() => {})
}

function RouteSurfaceSync() {
  'use no memo'

  const syncSurface = useSurfaceStore(state => state.syncSurface)
  const lastSyncedRouteKeyRef = useRef<string | null>(null)
  const routeSnapshot = useRouterState({
    select: (state) => {
      const location = state.location as typeof state.location & { href?: string }
      return {
        routeKey: createRouteSurfaceSyncRouteKey(location),
        surface: surfaceDraftFromRouterState(state),
      }
    },
    structuralSharing: true,
  })

  useEffect(() => {
    const surface = routeSnapshot.surface
    if (!surface) {
      return
    }

    if (surface.kind === 'settings') {
      return
    }

    if (isRouteSurfaceSyncSuppressed(surface.id)) {
      return
    }

    const syncKey = `${routeSnapshot.routeKey}:${surface.id}`
    if (lastSyncedRouteKeyRef.current === syncKey) {
      return
    }
    lastSyncedRouteKeyRef.current = syncKey
    syncSurface(surface)
  }, [routeSnapshot, syncSurface])

  return null
}

export function AppRouteRoot() {
  'use no memo'

  const onboardingCompleted = useOnboardingStore(s => s.completed)
  const location = useLocation()
  const navigate = useNavigate()
  const isOnboardingRoute = location.pathname === '/onboarding'

  useThemeClass()

  useEffect(() => {
    if (isTearoffWindow) {
      return
    }
    if (!onboardingCompleted && !isOnboardingRoute) {
      void navigate({ to: '/onboarding', replace: true })
      return
    }
    if (onboardingCompleted && isOnboardingRoute) {
      void navigate({ to: '/', replace: true })
    }
  }, [isOnboardingRoute, navigate, onboardingCompleted])

  if (isTearoffWindow) {
    return <TearoffAppRuntime />
  }

  if (!onboardingCompleted && !isOnboardingRoute) {
    return <div className="h-screen w-screen bg-background" />
  }

  if (isOnboardingRoute) {
    return (
      <>
        <RouteSurfaceSync />
        <Outlet />
      </>
    )
  }

  return (
    <>
      <RouteSurfaceSync />
      <MainAppRuntime />
      <CredentialSetupDialog />
    </>
  )
}

function TearoffAppRuntime() {
  'use no memo'

  const surfaceRoute = tearoffSurfaceRoute
  const navigate = useNavigate()

  useEffect(() => {
    document.body.dataset.surface = 'tearoff'
  }, [])

  useEffect(() => {
    if (!surfaceRoute) {
      return
    }
    void navigate({ ...surfaceRoute, replace: true } as Parameters<typeof navigate>[0])
  }, [navigate, surfaceRoute])

  useEffect(() => {
    return installSurfaceResourceLifecycle()
  }, [])

  if (!surfaceRoute) {
    return (
      <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
        <div className="h-full w-full bg-background" />
      </div>
    )
  }

  return (
    <>
      <RouteSurfaceSync />
      <TearoffLayoutScope>
        <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
          <AppLayout sessionScoped showFooter={false}>
            <SurfaceActivityProvider active>
              <Outlet />
            </SurfaceActivityProvider>
          </AppLayout>
        </div>
      </TearoffLayoutScope>
    </>
  )
}

function TearoffLayoutScope({ children }: { children: React.ReactNode }) {
  // The tear-off window renders a single surface; scope layout slots to that
  // surface so its aside/panel chrome resolves correctly. The slot id is
  // derived from the surface route (the tear-off window's surface store is
  // intentionally empty — it only renders the one torn-off surface).
  const slotId = layoutSlotIdForRoute(tearoffSurfaceRoute)
  useSyncLayoutSlotScope(slotId, slotId ? [slotId] : [])
  return children
}

function MainAppRuntime() {
  'use no memo'

  const sidebarInSheet = useSidebarSheetMode()
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false)
  const activeSurface = useActiveSurface()
  const layoutSlotScope = useSurfaceStore(
    useShallow((state) => {
      const validSlotIds = state.surfaces
        .map(layoutSlotIdForSurface)
        .filter((id): id is string => id !== null)
      return {
        validSurfaceIdsKey: state.surfaces.map(surface => surface.id).join('\0'),
        validSlotIdsKey: validSlotIds.join('\0'),
      }
    }),
  )
  const validSurfaceIds = useMemo(
    () =>
      layoutSlotScope.validSurfaceIdsKey ? layoutSlotScope.validSurfaceIdsKey.split('\0') : [],
    [layoutSlotScope.validSurfaceIdsKey],
  )
  const validSlotIds = useMemo(
    () => (layoutSlotScope.validSlotIdsKey ? layoutSlotScope.validSlotIdsKey.split('\0') : []),
    [layoutSlotScope.validSlotIdsKey],
  )
  const activeSlotId = layoutSlotIdForSurface(activeSurface)

  useSyncLayoutSlotScope(activeSlotId, validSlotIds)

  const openGlobalSearch = useCallback(() => {
    void loadGlobalSearchDialog()
    useGlobalSearchStore.getState().openSearch()
  }, [])
  const openSidebarSheet = useCallback(() => {
    setSidebarSheetOpen(true)
  }, [])
  const toggleSidebarSheet = useCallback(() => {
    setSidebarSheetOpen(open => !open)
  }, [])
  const unreadSessionIds = useUnreadSessionIds()

  useDesktopTrayActionBridge({ onOpenGlobalSearch: openGlobalSearch })

  useEffect(() => {
    return installSurfaceResourceLifecycle()
  }, [])

  useEffect(() => {
    return installTearoffSurfaceRestore()
  }, [])

  useEffect(() => {
    syncDesktopAppBadgeUnreadCount(unreadSessionIds.size)
  }, [unreadSessionIds.size])

  useEffect(() => {
    if (!sidebarInSheet) {
      setSidebarSheetOpen(false)
    }
  }, [sidebarInSheet])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
      {!sidebarInSheet && <AppSidebar />}
      {sidebarInSheet && (
        <AppSidebarSheet open={sidebarSheetOpen} onOpenChange={setSidebarSheetOpen} />
      )}
      <AppLayout
        sidebarInSheet={sidebarInSheet}
        sidebarSheetOpen={sidebarSheetOpen}
        onOpenSidebarSheet={openSidebarSheet}
        onToggleSidebarSheet={toggleSidebarSheet}
        validChromeOwnerIds={validSurfaceIds}
      >
        <div className="relative h-full w-full overflow-hidden">
          <SurfaceActivityProvider active>
            <Outlet />
          </SurfaceActivityProvider>
          <GlobalCommandPaletteHost />
          <KeyBindingsOverlayHost />
        </div>
      </AppLayout>
      <StreamingChatRetentionBoundary />
      <WhatsNewTrigger />
    </div>
  )
}

function StreamingChatRetentionBoundary() {
  'use no memo'

  const hasStreamingSessions = useChatStore((state) => {
    for (const sessionId of state.messagesMap.keys()) {
      if (chatSelectors.isSessionStreaming(sessionId)(state)) {
        return true
      }
    }
    return false
  })

  if (!hasStreamingSessions) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <StreamingChatRetentionHost />
    </Suspense>
  )
}

function GlobalCommandPaletteHost() {
  'use no memo'

  const open = useGlobalSearchStore(s => s.open)
  const initialQuery = useGlobalSearchStore(s => s.initialQuery)
  const setOpen = useGlobalSearchStore(s => s.setOpen)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return
      }

      const isMod = event.metaKey || event.ctrlKey
      if (!isMod || event.altKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'k') {
        if (isWorkspaceFileShortcutScopeEvent(event)) {
          return
        }
        event.preventDefault()
        void loadGlobalSearchDialog()
        useGlobalSearchStore.getState().openPalette('>')
        return
      }

      if (key === 'p') {
        event.preventDefault()
        void loadGlobalSearchDialog()
        useGlobalSearchStore.getState().openPalette(event.shiftKey ? '>' : '')
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  if (!open) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <GlobalSearchDialog open={open} initialQuery={initialQuery} onOpenChange={setOpen} />
    </Suspense>
  )
}

function KeyBindingsOverlayHost() {
  'use no memo'

  const open = useKeyBindingsOverlayStore(s => s.open)
  const shortcutGestureRef = useRef<{ held: boolean, openedByPress: boolean } | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return
      }

      // `Cmd+/` (or `Ctrl+/`) works as either a tap toggle or a hold-to-peek
      // gesture. Editable surfaces intentionally share the same binding so the
      // reference stays discoverable from the composer.
      if (!isKeyBindingsOverlayShortcut(event)) {
        return
      }

      event.preventDefault()

      const currentGesture = shortcutGestureRef.current
      if (event.repeat) {
        if (currentGesture) {
          currentGesture.held = true
        }
        return
      }

      const store = useKeyBindingsOverlayStore.getState()
      if (store.open) {
        store.closeOverlay()
        shortcutGestureRef.current = {
          held: false,
          openedByPress: false,
        }
        return
      }

      void loadKeyBindingsOverlay()
      store.openOverlay()
      shortcutGestureRef.current = {
        held: false,
        openedByPress: true,
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      const currentGesture = shortcutGestureRef.current
      if (!currentGesture || !isKeyBindingsOverlayShortcutRelease(event)) {
        return
      }

      shortcutGestureRef.current = null
      if (currentGesture.held && currentGesture.openedByPress) {
        event.preventDefault()
        useKeyBindingsOverlayStore.getState().closeOverlay()
      }
    }

    const onBlur = (): void => {
      const currentGesture = shortcutGestureRef.current
      shortcutGestureRef.current = null
      if (currentGesture?.held && currentGesture.openedByPress) {
        useKeyBindingsOverlayStore.getState().closeOverlay()
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  if (!open) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <KeyBindingsOverlay />
    </Suspense>
  )
}
