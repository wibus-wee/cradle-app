import { Outlet, useLocation, useNavigate, useRouterState } from '@tanstack/react-router'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useThemeClass } from '~/app-providers'
import { AppLayout } from '~/components/layout/app-layout'
import { AppSidebar, AppSidebarSheet } from '~/components/layout/app-sidebar'
import { useSidebarSheetMode } from '~/components/layout/layout-responsive'
import { useSyncLayoutSlotScope } from '~/components/layout/use-layout-slots'
import { useSuppressNativeBrowserSurface } from '~/features/browser/native-surface-suppression'
import { WhatsNewContainer } from '~/features/changelog/whats-new-container'
import { WhatsNewPopup } from '~/features/changelog/whats-new-popup'
import { useChatSplitFocusedSessionId, useChatSplitWorkspaceStore } from '~/features/chat/split-workspace/chat-split-workspace-store'
import { useDesktopTrayActionBridge } from '~/features/desktop-tray/use-desktop-tray-action-bridge'
import { CredentialSetupDialog } from '~/features/onboarding/credential-setup-dialog'
import { useOnboardingStore } from '~/features/onboarding/onboarding-store'
import { GlobalSearchDialog } from '~/features/search/global-search-dialog'
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

const loadKeyBindingsOverlay = () =>
  import('~/features/shortcuts/key-bindings-overlay').then(module => ({
    default: module.KeyBindingsOverlay,
  }))

const KeyBindingsOverlay = lazy(loadKeyBindingsOverlay)

const StreamingChatRetentionHost = lazy(() =>
  import('~/features/chat/session/streaming-chat-retention-host').then(module => ({
    default: module.StreamingChatRetentionHost,
  })))

const KEY_BINDINGS_OVERLAY_HOLD_RELEASE_MIN_IDLE_MS = 44
const KEY_BINDINGS_OVERLAY_HOLD_RELEASE_FALLBACK_IDLE_MS = 90
const KEY_BINDINGS_OVERLAY_HOLD_RELEASE_MAX_IDLE_MS = 160
const KEY_BINDINGS_OVERLAY_HOLD_RELEASE_IDLE_MULTIPLIER = 1.35

function isKeyBindingsOverlayShortcut(event: KeyboardEvent): boolean {
  const isMod = event.metaKey || event.ctrlKey
  const isSlash = event.key === '/' || event.code === 'Slash'
  return isMod && isSlash && !event.altKey && !event.shiftKey
}

function isKeyBindingsOverlayShortcutRelease(event: KeyboardEvent): boolean {
  return event.key === '/' || event.code === 'Slash' || event.key === 'Meta' || event.key === 'Control'
}

function readKeyBindingsOverlayHoldReleaseIdleMs(repeatIntervalMs: number | null): number {
  if (repeatIntervalMs === null || !Number.isFinite(repeatIntervalMs)) {
    return KEY_BINDINGS_OVERLAY_HOLD_RELEASE_FALLBACK_IDLE_MS
  }
  return Math.max(
    KEY_BINDINGS_OVERLAY_HOLD_RELEASE_MIN_IDLE_MS,
    Math.min(
      KEY_BINDINGS_OVERLAY_HOLD_RELEASE_MAX_IDLE_MS,
      repeatIntervalMs * KEY_BINDINGS_OVERLAY_HOLD_RELEASE_IDLE_MULTIPLIER,
    ),
  )
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

  // A chat surface split into multiple dockview panes registers layout slots
  // (aside/panel) per pane session id, not just the primary (URL) session —
  // extend the valid scope so the currently focused pane's chrome resolves,
  // and follow that pane instead of always the primary one.
  const activeSurfaceId = activeSurface?.id ?? null
  const activeSplitPaneSessionIds = useChatSplitWorkspaceStore(
    useShallow(state => (activeSurfaceId ? state.workspaces[activeSurfaceId]?.paneSessionIds : undefined)),
  )
  const focusedSplitSessionId = useChatSplitFocusedSessionId(activeSurfaceId)

  const validSlotIds = useMemo(() => {
    const base = layoutSlotScope.validSlotIdsKey ? layoutSlotScope.validSlotIdsKey.split('\0') : []
    if (!activeSplitPaneSessionIds || activeSplitPaneSessionIds.length <= 1) {
      return base
    }
    return Array.from(new Set([...base, ...activeSplitPaneSessionIds]))
  }, [layoutSlotScope.validSlotIdsKey, activeSplitPaneSessionIds])
  const activeSlotId = focusedSplitSessionId ?? layoutSlotIdForSurface(activeSurface)

  useSyncLayoutSlotScope(activeSlotId, validSlotIds)

  const openGlobalSearch = useCallback(() => {
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
      <WhatsNewContainer />
      <WhatsNewPopup />
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
  useSuppressNativeBrowserSurface(open)

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
        useGlobalSearchStore.getState().openPalette(event.shiftKey ? '>' : '')
        return
      }

      if (key === 'p') {
        event.preventDefault()
        useGlobalSearchStore.getState().openPalette(event.shiftKey ? '>' : '')
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  return <GlobalSearchDialog open={open} initialQuery={initialQuery} onOpenChange={setOpen} />
}

function KeyBindingsOverlayHost() {
  'use no memo'

  const open = useKeyBindingsOverlayStore(s => s.open)
  useSuppressNativeBrowserSurface(open)
  const shortcutGestureRef = useRef<{
    held: boolean
    lastRepeatAt: number | null
    openedByPress: boolean
    repeatIntervalMs: number | null
  } | null>(null)
  const holdReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const clearHoldReleaseTimer = (): void => {
      if (holdReleaseTimerRef.current !== null) {
        clearTimeout(holdReleaseTimerRef.current)
        holdReleaseTimerRef.current = null
      }
    }

    const closeHeldPeek = (): void => {
      const currentGesture = shortcutGestureRef.current
      shortcutGestureRef.current = null
      clearHoldReleaseTimer()
      if (currentGesture?.held && currentGesture.openedByPress) {
        useKeyBindingsOverlayStore.getState().closeOverlay()
      }
    }

    const scheduleHeldPeekRelease = (repeatIntervalMs: number | null): void => {
      clearHoldReleaseTimer()
      holdReleaseTimerRef.current = setTimeout(
        closeHeldPeek,
        readKeyBindingsOverlayHoldReleaseIdleMs(repeatIntervalMs),
      )
    }

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
          if (currentGesture.lastRepeatAt !== null) {
            const intervalMs = event.timeStamp - currentGesture.lastRepeatAt
            if (intervalMs > 0 && Number.isFinite(intervalMs)) {
              currentGesture.repeatIntervalMs = currentGesture.repeatIntervalMs === null
                ? intervalMs
                : currentGesture.repeatIntervalMs * 0.6 + intervalMs * 0.4
            }
          }
          currentGesture.lastRepeatAt = event.timeStamp
          currentGesture.held = true
          if (currentGesture.openedByPress) {
            scheduleHeldPeekRelease(currentGesture.repeatIntervalMs)
          }
        }
        return
      }

      clearHoldReleaseTimer()
      const store = useKeyBindingsOverlayStore.getState()
      if (store.open) {
        store.closeOverlay()
        shortcutGestureRef.current = {
          held: false,
          lastRepeatAt: null,
          openedByPress: false,
          repeatIntervalMs: null,
        }
        return
      }

      void loadKeyBindingsOverlay()
      store.openOverlay()
      shortcutGestureRef.current = {
        held: false,
        lastRepeatAt: null,
        openedByPress: true,
        repeatIntervalMs: null,
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      const currentGesture = shortcutGestureRef.current
      if (!currentGesture || !isKeyBindingsOverlayShortcutRelease(event)) {
        return
      }

      clearHoldReleaseTimer()
      shortcutGestureRef.current = null
      if (currentGesture.held && currentGesture.openedByPress) {
        event.preventDefault()
        useKeyBindingsOverlayStore.getState().closeOverlay()
      }
    }

    const onBlur = (): void => {
      const currentGesture = shortcutGestureRef.current
      shortcutGestureRef.current = null
      clearHoldReleaseTimer()
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
      clearHoldReleaseTimer()
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
