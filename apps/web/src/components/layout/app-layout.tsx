import type { AnimationPlaybackControls, Transition } from 'motion/react'
import { animate, m, useMotionValue } from 'motion/react'
import type { ReactNode } from 'react'
import {
  Activity,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { AppFooter } from '~/components/layout/app-footer'
import { AppHeader } from '~/components/layout/app-header'
import { DevBottomBar } from '~/components/layout/dev-bottom-bar'
import { deriveActiveLayoutContract } from '~/components/layout/layout-contract'
import {
  LayoutGeometryProvider,
  useLayoutGeometry,
} from '~/components/layout/layout-geometry-context'
import {
  CENTER_COLUMN_EXPANDED_SCALE,
  CENTER_COLUMN_EXPANDED_Y,
} from '~/components/layout/layout-motion'
import { ResizeHandle } from '~/components/layout/resize-handle'
import {
  useChatSessionLayoutRecord,
  useWorkspaceLayoutRecord,
} from '~/components/layout/use-layout-query-records'
import { useLayoutSlotsCtx } from '~/components/layout/use-layout-slots'
import { Skeleton } from '~/components/ui/skeleton'
import { useJarvisUiStore } from '~/features/system-agent/jarvis-ui-store'
import { useGlobalEventListeners } from '~/hooks/use-global-event-listeners'
import { useShortcut } from '~/hooks/use-shortcut'
import { cn } from '~/lib/cn'
import { isElectron } from '~/lib/electron'
import { useActiveSurface } from '~/navigation/active-surface'
import { chatSessionIdForSurface } from '~/navigation/surface-identity'
import type { BrowserTabSource } from '~/store/browser-panel'
import { DEFAULT_BROWSER_PANEL_OWNER_ID, useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

const ASIDE = { min: 200, max: 560 }
const PANEL = { min: 80, max: 480 }

const SPRING = { type: 'spring', stiffness: 600, damping: 50 } as const
const INSTANT = { duration: 0 } as const
const BROWSER_NATIVE_BOUNDS_SETTLE_MS = 420

type BrowserBridgeCleanup = () => void

const LazyBrowserPanel = lazy(() =>
  import('~/features/browser').then(module => ({
    default: module.BrowserPanel,
  })))

const loadRightAside = () =>
  import('~/components/layout/right-aside').then(module => ({
    default: module.RightAside,
  }))

const LazyRightAside = lazy(loadRightAside)

const MemoizedRightAside = memo(LazyRightAside)
MemoizedRightAside.displayName = 'MemoizedRightAside'

function useAnimatedSize(initialSize: number) {
  const size = useMotionValue(initialSize)
  const animationRef = useRef<AnimationPlaybackControls | null>(null)

  const stopAnimation = useCallback(() => {
    animationRef.current?.stop()
    animationRef.current = null
  }, [])

  const setSize = useCallback(
    (nextSize: number) => {
      stopAnimation()
      size.set(nextSize)
    },
    [size, stopAnimation],
  )

  const animateSize = useCallback(
    (nextSize: number, transition: Transition) => {
      stopAnimation()
      animationRef.current = animate(size, nextSize, transition)
      return animationRef.current
    },
    [size, stopAnimation],
  )

  useEffect(
    () => () => {
      stopAnimation()
    },
    [stopAnimation],
  )

  return useMemo(
    () => ({ size, setSize, animateSize, stopAnimation }),
    [animateSize, setSize, size, stopAnimation],
  )
}

function parseBrowserTabRequest(payload: unknown): string | undefined {
  return typeof payload === 'object'
    && payload !== null
    && 'url' in payload
    && typeof payload.url === 'string'
    ? payload.url
    : undefined
}

function installBrowserUseBridge({
  ownerId,
  openBrowserPanel,
  closeBrowserPanel,
  readBrowserTabSource: _readBrowserTabSource,
}: {
  ownerId: string | null
  openBrowserPanel: () => void
  closeBrowserPanel: () => void
  readBrowserTabSource: () => BrowserTabSource
}): BrowserBridgeCleanup {
  const resolvedOwnerId = ownerId ?? DEFAULT_BROWSER_PANEL_OWNER_ID
  const requestBrowserTab = (payload: unknown) => {
    openBrowserPanel()
    useBrowserPanelStore.getState().requestTab(parseBrowserTabRequest(payload), undefined, ownerId)
  }
  const createBrowserTab = async (url?: string) => {
    openBrowserPanel()
    const bridge = window.cradle?.browser
    if (!bridge) {
      return useBrowserPanelStore.getState().createTab(url, undefined, ownerId)
    }
    const currentState = await bridge.getState({ threadId: resolvedOwnerId })
    const nextState = currentState.open
      ? await bridge.newTab({
          threadId: resolvedOwnerId,
          url: url ?? 'about:blank',
          activate: true,
        })
      : await bridge.open({ threadId: resolvedOwnerId, initialUrl: url ?? 'about:blank' })
    useBrowserPanelStore.getState().upsertOwnerState(nextState)
    return nextState.activeTabId ?? nextState.tabs.at(-1)?.id ?? ''
  }
  const activateBrowserTab = async (tabId: string) => {
    const bridge = window.cradle?.browser
    if (!bridge) {
      return false
    }
    try {
      openBrowserPanel()
      const nextState = await bridge.selectTab({ threadId: resolvedOwnerId, tabId })
      useBrowserPanelStore.getState().upsertOwnerState(nextState)
      return true
    }
 catch {
      return false
    }
  }
  const getActiveBrowserTab = async () => {
    const bridge = window.cradle?.browser
    if (!bridge) {
      const state = useBrowserPanelStore.getState()
      const ownerState = state.owners[resolvedOwnerId]
      return ownerState?.activeTabId ?? undefined
    }
    const state = await bridge.getState({ threadId: resolvedOwnerId })
    useBrowserPanelStore.getState().upsertOwnerState(state)
    return state.activeTabId ?? undefined
  }
  const hideBrowserPanel = async (tabId?: string) => {
    const bridge = window.cradle?.browser
    if (tabId && bridge) {
      const state = await bridge.getState({ threadId: resolvedOwnerId })
      if (!state.tabs.some(tab => tab.id === tabId)) {
        return false
      }
    }
    closeBrowserPanel()
    if (bridge) {
      await bridge.hide({ threadId: resolvedOwnerId })
    }
    return true
  }

  window.__cradleBrowserUseCreateTab = createBrowserTab
  window.__cradleBrowserUseActivateTab = activateBrowserTab
  window.__cradleBrowserUseGoOffScreen = hideBrowserPanel
  window.__cradleBrowserUseGetActiveTab = getActiveBrowserTab
  const unsubscribeBrowserUse = window.cradle?.ipc.on('browser-use:create-tab', requestBrowserTab)
  const unsubscribeBrowserPanelPopup = window.cradle?.ipc.on(
    'browser-panel:open-url',
    requestBrowserTab,
  )

  return () => {
    if (window.__cradleBrowserUseCreateTab) {
      delete window.__cradleBrowserUseCreateTab
    }
    if (window.__cradleBrowserUseActivateTab) {
      delete window.__cradleBrowserUseActivateTab
    }
    if (window.__cradleBrowserUseGoOffScreen) {
      delete window.__cradleBrowserUseGoOffScreen
    }
    if (window.__cradleBrowserUseGetActiveTab) {
      delete window.__cradleBrowserUseGetActiveTab
    }
    unsubscribeBrowserUse?.()
    unsubscribeBrowserPanelPopup?.()
  }
}

interface AppLayoutProps {
  children?: ReactNode
  /** Show browser panel toggle in header */
  hasBrowserPanel?: boolean
  /** Show bottom panel toggle in header */
  hasPanel?: boolean
  /** Bottom panel content */
  panel?: ReactNode
  /** Limit route surface chrome actions to the current session window. */
  sessionScoped?: boolean
  /** Show the main-window footer surface. */
  showFooter?: boolean
  /** Render the left sidebar as a transient chrome sheet instead of a docked column. */
  sidebarInSheet?: boolean
  /** Current transient left sidebar sheet presentation state. */
  sidebarSheetOpen?: boolean
  /** Opens the transient left sidebar sheet. */
  onOpenSidebarSheet?: () => void
  /** Toggles the transient left sidebar sheet. */
  onToggleSidebarSheet?: () => void
  /** Surface-owned chrome cache scope. Owners not listed here are released. */
  validChromeOwnerIds?: readonly string[]
}

export function AppLayout({
  children,
  hasBrowserPanel,
  hasPanel,
  panel,
  sessionScoped = false,
  showFooter = true,
  sidebarInSheet = false,
  sidebarSheetOpen = false,
  onOpenSidebarSheet,
  onToggleSidebarSheet,
  validChromeOwnerIds,
}: AppLayoutProps) {
  return (
    <LayoutGeometryProvider>
      <AppLayoutContent
        hasBrowserPanel={hasBrowserPanel}
        hasPanel={hasPanel}
        panel={panel}
        sessionScoped={sessionScoped}
        showFooter={showFooter}
        sidebarInSheet={sidebarInSheet}
        sidebarSheetOpen={sidebarSheetOpen}
        onOpenSidebarSheet={onOpenSidebarSheet}
        onToggleSidebarSheet={onToggleSidebarSheet}
        validChromeOwnerIds={validChromeOwnerIds}
      >
        {children}
      </AppLayoutContent>
    </LayoutGeometryProvider>
  )
}

function ownerIsInScope(ownerId: string, validOwnerIds: readonly string[] | undefined): boolean {
  return !validOwnerIds || validOwnerIds.includes(ownerId)
}

interface BrowserPanelDescriptor {
  ownerId: string
  activeSessionId: string | null
  activeSessionTitle: string | null
  terminalCwd: string | null
}

function areBrowserPanelDescriptorsEqual(
  left: BrowserPanelDescriptor,
  right: BrowserPanelDescriptor,
): boolean {
  return (
    left.ownerId === right.ownerId
    && left.activeSessionId === right.activeSessionId
    && left.activeSessionTitle === right.activeSessionTitle
    && left.terminalCwd === right.terminalCwd
  )
}

function RetainedBrowserPanels({
  active,
  activeSessionId,
  activeSessionTitle,
  nativeBoundsPaused,
  onCloseLastTab,
  ownerId,
  terminalCwd,
  validOwnerIds,
  visible,
}: {
  active: boolean
  activeSessionId: string | null
  activeSessionTitle: string | null
  nativeBoundsPaused: boolean
  onCloseLastTab: (ownerId: string) => void
  ownerId: string | null
  terminalCwd: string | null
  validOwnerIds?: readonly string[]
  visible: boolean
}) {
  const validOwnerIdsKey = validOwnerIds?.join('\0') ?? null
  const [descriptors, setDescriptors] = useState<BrowserPanelDescriptor[]>([])

  useLayoutEffect(() => {
    setDescriptors((current) => {
      const next = current.filter(descriptor => ownerIsInScope(descriptor.ownerId, validOwnerIds))
      if (active && ownerId) {
        const descriptor: BrowserPanelDescriptor = {
          ownerId,
          activeSessionId,
          activeSessionTitle,
          terminalCwd,
        }
        const index = next.findIndex(item => item.ownerId === ownerId)
        if (index === -1) {
          next.push(descriptor)
        }
        else if (!areBrowserPanelDescriptorsEqual(next[index]!, descriptor)) {
          next[index] = descriptor
        }
      }
      return next.length === current.length
        && next.every((descriptor, index) => descriptor === current[index])
        ? current
        : next
    })
  }, [
    active,
    activeSessionId,
    activeSessionTitle,
    ownerId,
    terminalCwd,
    validOwnerIds,
    validOwnerIdsKey,
  ])

  return (
    <>
      {descriptors.map((descriptor) => {
        const panelVisible = visible && descriptor.ownerId === ownerId
        return (
          <Activity
            key={descriptor.ownerId}
            mode={panelVisible ? 'visible' : 'hidden'}
            name={`browser-panel:${descriptor.ownerId}`}
          >
            <Suspense fallback={null}>
              <LazyBrowserPanel
                ownerId={descriptor.ownerId}
                activeSessionId={descriptor.activeSessionId}
                activeSessionTitle={descriptor.activeSessionTitle}
                terminalCwd={descriptor.terminalCwd}
                nativeBoundsPaused={nativeBoundsPaused}
                nativeSurfaceVisible={panelVisible}
                onCloseLastTab={onCloseLastTab}
              />
            </Suspense>
          </Activity>
        )
      })}
    </>
  )
}

interface BottomPanelDescriptor {
  ownerId: string
  panel: ReactNode
}

function RetainedBottomPanels({
  active,
  ownerId,
  panel,
  validOwnerIds,
  visible,
}: {
  active: boolean
  ownerId: string | null
  panel: ReactNode | undefined
  validOwnerIds?: readonly string[]
  visible: boolean
}) {
  const validOwnerIdsKey = validOwnerIds?.join('\0') ?? null
  const [descriptors, setDescriptors] = useState<BottomPanelDescriptor[]>([])

  useLayoutEffect(() => {
    setDescriptors((current) => {
      const next = current.filter(descriptor => ownerIsInScope(descriptor.ownerId, validOwnerIds))
      if (active && ownerId && panel) {
        const descriptor: BottomPanelDescriptor = { ownerId, panel }
        const index = next.findIndex(item => item.ownerId === ownerId)
        if (index === -1) {
          next.push(descriptor)
        }
        else if (!Object.is(next[index]!.panel, panel)) {
          next[index] = descriptor
        }
      }
      return next.length === current.length
        && next.every((descriptor, index) => descriptor === current[index])
        ? current
        : next
    })
  }, [active, ownerId, panel, validOwnerIds, validOwnerIdsKey])

  return (
    <>
      {descriptors.map((descriptor) => {
        const panelVisible = visible && descriptor.ownerId === ownerId
        return (
          <Activity
            key={descriptor.ownerId}
            mode={panelVisible ? 'visible' : 'hidden'}
            name={`bottom-panel:${descriptor.ownerId}`}
          >
            <div className="h-full" aria-hidden={panelVisible ? undefined : 'true'}>
              {descriptor.panel}
            </div>
          </Activity>
        )
      })}
    </>
  )
}

interface RightAsideDescriptor {
  ownerId: string
  sessionId: string | null
  workspaceId: string | null
  workspaceName: string | null
  workspacePath: string | null
}

function areRightAsideDescriptorsEqual(
  left: RightAsideDescriptor,
  right: RightAsideDescriptor,
): boolean {
  return (
    left.ownerId === right.ownerId
    && left.sessionId === right.sessionId
    && left.workspaceId === right.workspaceId
    && left.workspaceName === right.workspaceName
    && left.workspacePath === right.workspacePath
  )
}

function RetainedRightAsides({
  acceptCurrentOwner,
  ownerId,
  sessionId,
  validOwnerIds,
  visible,
  workspaceId,
  workspaceName,
  workspacePath,
}: {
  acceptCurrentOwner: boolean
  ownerId: string | null
  sessionId: string | null
  validOwnerIds?: readonly string[]
  visible: boolean
  workspaceId: string | null
  workspaceName: string | null
  workspacePath: string | null
}) {
  const validOwnerIdsKey = validOwnerIds?.join('\0') ?? null
  const [descriptors, setDescriptors] = useState<RightAsideDescriptor[]>([])

  useLayoutEffect(() => {
    setDescriptors((current) => {
      const next = current.filter(descriptor => ownerIsInScope(descriptor.ownerId, validOwnerIds) && (acceptCurrentOwner || descriptor.ownerId !== ownerId))
      if (acceptCurrentOwner && ownerId) {
        const descriptor: RightAsideDescriptor = {
          ownerId,
          sessionId,
          workspaceId,
          workspaceName,
          workspacePath,
        }
        const index = next.findIndex(item => item.ownerId === ownerId)
        if (index === -1) {
          next.push(descriptor)
        }
        else if (!areRightAsideDescriptorsEqual(next[index]!, descriptor)) {
          next[index] = descriptor
        }
      }
      return next.length === current.length
        && next.every((descriptor, index) => descriptor === current[index])
        ? current
        : next
    })
  }, [
    acceptCurrentOwner,
    ownerId,
    sessionId,
    validOwnerIds,
    validOwnerIdsKey,
    workspaceId,
    workspaceName,
    workspacePath,
  ])

  return (
    <>
      {descriptors.map((descriptor) => {
        const asideVisible = visible && descriptor.ownerId === ownerId
        const currentOwnerMounted = descriptor.ownerId === ownerId
        return (
          <Activity
            key={descriptor.ownerId}
            mode={currentOwnerMounted ? 'visible' : 'hidden'}
            name={`right-aside:${descriptor.ownerId}`}
          >
            <Suspense fallback={<RightAsideFallback />}>
              <MemoizedRightAside
                ownerId={descriptor.ownerId}
                visible={asideVisible}
                sessionId={descriptor.sessionId}
                workspaceId={descriptor.workspaceId}
                workspaceName={descriptor.workspaceName}
                workspacePath={descriptor.workspacePath}
              />
            </Suspense>
          </Activity>
        )
      })}
    </>
  )
}

function RightAsideFallback() {
  return (
    <div
      className="flex h-full flex-1 flex-col overflow-hidden"
      data-testid="right-aside-fallback"
    >
      <div className="flex shrink-0 justify-center border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <Skeleton className="h-7 w-2/3 rounded-md" />
        <Skeleton className="h-5 w-full rounded" />
        <Skeleton className="h-5 w-5/6 rounded" />
        <Skeleton className="h-5 w-3/4 rounded" />
      </div>
    </div>
  )
}

function AppLayoutContent({
  children,
  hasBrowserPanel,
  hasPanel,
  panel,
  sessionScoped = false,
  showFooter = true,
  sidebarInSheet = false,
  sidebarSheetOpen = false,
  onOpenSidebarSheet,
  onToggleSidebarSheet,
  validChromeOwnerIds,
}: AppLayoutProps) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [browserNativeBoundsPaused, setBrowserNativeBoundsPaused] = useState(false)
  const [browserPanelClosing, setBrowserPanelClosing] = useState(false)
  const mainElementRef = useRef<HTMLElement | null>(null)
  const previousBrowserPanelVisibleRef = useRef(false)
  const browserNativeBoundsResumeTimerRef = useRef<number | null>(null)
  const browserPanelWidthAnimationIdRef = useRef(0)
  const browserPanelWidthAnimatingRef = useRef(false)
  const mainRef = useCallback((el: HTMLElement | null) => {
    mainElementRef.current = el
  }, [])
  const readMainWidth = useCallback(() => {
    return mainElementRef.current?.clientWidth ?? 800
  }, [])
  const updateDragging = useCallback((value: string | null) => {
    setDragging(value)
  }, [])

  const { registerCenterColumn } = useLayoutGeometry()

  // Route surface layout slots registered by route content components.
  const { slots } = useLayoutSlotsCtx()
  const activeSurface = useActiveSurface()
  const activeTab = activeSurface
    ? {
        type: activeSurface.kind === 'workspace' ? 'workspace-detail' : activeSurface.kind,
        label: activeSurface.title,
        params: activeSurface.route.params ?? {},
      }
    : undefined
  const activeSessionId = chatSessionIdForSurface(activeSurface)
  const activeSessionTitle = activeTab?.type === 'chat' ? activeTab.label : null
  const activeChromeOwnerId = activeSurface?.id ?? null
  const activeBrowserPanelOwnerId = activeChromeOwnerId
  const activeSessionLayout = useChatSessionLayoutRecord(activeSessionId)
  const layoutContract = deriveActiveLayoutContract({
    activeTab,
    slots,
    sessionLayout: activeSessionLayout,
    explicitPanel: panel,
    explicitHasBrowserPanel: hasBrowserPanel,
    explicitHasPanel: hasPanel,
  })

  const resolvedPanel = layoutContract.panel
  const resolvedAsideSessionId = layoutContract.asideSessionId
  const resolvedAsideWorkspaceId = layoutContract.asideWorkspaceId
  const resolvedHasAside = layoutContract.hasAside
  const resolvedHasBrowserPanel = layoutContract.hasBrowserPanel
  const resolvedHasPanel = layoutContract.hasPanel
  const resolvedWorkspaceLayout = useWorkspaceLayoutRecord(resolvedAsideWorkspaceId)
  const resolvedAsideWorkspacePath
    = resolvedWorkspaceLayout?.workspacePath
      ?? (activeSessionLayout?.workspaceId === resolvedAsideWorkspaceId
      ? activeSessionLayout.workspacePath
      : null)
  const resolvedAsideWorkspaceName = resolvedWorkspaceLayout?.workspaceName ?? null
  const jarvisExpanded = useJarvisUiStore(s => s.expanded)

  useGlobalEventListeners({ workspacePath: resolvedAsideWorkspacePath })

  const bottomPanelHeight = useLayoutStore(state => state.bottomPanelHeight)
  const setBottomPanelHeight = useLayoutStore(state => state.setBottomPanelHeight)
  const bottomPanelOpen = useLayoutStore(state => state.bottomPanelOpen)
  const browserPanelOpen = useLayoutStore(state =>
    activeBrowserPanelOwnerId
      ? (state.browserPanelOpenByOwnerId[activeBrowserPanelOwnerId] ?? false)
      : false)
  const browserPanelRatio = useLayoutStore(state => state.browserPanelRatio)
  const setBrowserPanelOpen = useLayoutStore(state => state.setBrowserPanelOpen)
  const setBrowserPanelRatio = useLayoutStore(state => state.setBrowserPanelRatio)
  const setActiveBrowserPanelOwner = useLayoutStore(state => state.setActiveBrowserPanelOwner)
  const isSettings = activeSurface?.kind === 'settings'
  const canUseRightAside
    = !isSettings && !!resolvedHasAside && (!!resolvedAsideSessionId || !!resolvedAsideWorkspaceId)
  const resolvedBrowserPanelOpen = !isSettings && !!resolvedHasBrowserPanel && browserPanelOpen
  const browserPanelMounted = !!resolvedHasBrowserPanel
  const browserPanelVisible = browserPanelMounted && resolvedBrowserPanelOpen
  const browserPanelWidth = useAnimatedSize(
    browserPanelVisible ? browserPanelRatio * readMainWidth() : 0,
  )
  useLayoutEffect(() => {
    const previousBrowserPanelVisible = previousBrowserPanelVisibleRef.current
    previousBrowserPanelVisibleRef.current = browserPanelVisible

    if (browserPanelMounted && previousBrowserPanelVisible && !browserPanelVisible) {
      setBrowserPanelClosing(true)
      return
    }

    if (browserPanelVisible) {
      setBrowserPanelClosing(false)
    }
  }, [browserPanelMounted, browserPanelVisible])
  const readBrowserTabSource = useCallback((): BrowserTabSource => {
    return {
      sessionId: activeSessionId,
      sessionTitle: activeSessionTitle,
    }
  }, [activeSessionId, activeSessionTitle])
  const handleCloseLastBrowserPanelTab = useCallback(
    (ownerId: string) => {
      setBrowserPanelOpen(false, ownerId)
    },
    [setBrowserPanelOpen],
  )
  const clearBrowserNativeBoundsResumeTimer = useCallback(() => {
    if (browserNativeBoundsResumeTimerRef.current === null) {
      return
    }
    window.clearTimeout(browserNativeBoundsResumeTimerRef.current)
    browserNativeBoundsResumeTimerRef.current = null
  }, [])
  const pauseBrowserNativeBounds = useCallback(() => {
    if (!browserPanelVisible) {
      return
    }
    clearBrowserNativeBoundsResumeTimer()
    setBrowserNativeBoundsPaused(true)
  }, [browserPanelVisible, clearBrowserNativeBoundsResumeTimer])
  const resumeBrowserNativeBounds = useCallback(() => {
    clearBrowserNativeBoundsResumeTimer()
    setBrowserNativeBoundsPaused(false)
  }, [clearBrowserNativeBoundsResumeTimer])
  const pauseBrowserNativeBoundsForLayout = useCallback(
    (force = false) => {
      if (!force && !browserPanelVisible) {
        return
      }
      clearBrowserNativeBoundsResumeTimer()
      setBrowserNativeBoundsPaused(true)
      browserNativeBoundsResumeTimerRef.current = window.setTimeout(() => {
        browserNativeBoundsResumeTimerRef.current = null
        setBrowserNativeBoundsPaused(false)
      }, BROWSER_NATIVE_BOUNDS_SETTLE_MS)
    },
    [browserPanelVisible, clearBrowserNativeBoundsResumeTimer],
  )
  const handleBrowserPanelResize = useCallback(
    (px: number) => {
      browserPanelWidth.setSize(px)
    },
    [browserPanelWidth],
  )
  const handleBrowserPanelResizeEnd = useCallback(
    (px: number) => {
      const mainWidth = readMainWidth()
      const ratio = Math.max(0.2, Math.min(0.7, px / mainWidth))
      browserPanelWidthAnimationIdRef.current += 1
      browserPanelWidthAnimatingRef.current = false
      browserPanelWidth.setSize(px)
      setBrowserPanelRatio(ratio)
      updateDragging(null)
    },
    [browserPanelWidth, readMainWidth, setBrowserPanelRatio, updateDragging],
  )
  const handleBrowserPanelDragStart = useCallback(() => {
    browserPanelWidthAnimationIdRef.current += 1
    browserPanelWidthAnimatingRef.current = false
    browserPanelWidth.setSize(browserPanelWidth.size.get())
    updateDragging('browser')
  }, [browserPanelWidth, updateDragging])
  const handleBottomPanelDragStart = useCallback(() => {
    updateDragging('panel')
    pauseBrowserNativeBounds()
  }, [pauseBrowserNativeBounds, updateDragging])
  const handleBottomPanelDragEnd = useCallback(() => {
    updateDragging(null)
    resumeBrowserNativeBounds()
  }, [resumeBrowserNativeBounds, updateDragging])

  useEffect(
    () => () => {
      clearBrowserNativeBoundsResumeTimer()
    },
    [clearBrowserNativeBoundsResumeTimer],
  )

  useEffect(() => {
    if (dragging === 'browser') {
      return
    }
    const nextWidth = browserPanelVisible ? browserPanelRatio * readMainWidth() : 0
    if (Math.abs(browserPanelWidth.size.get() - nextWidth) < 0.5) {
      if (!browserPanelVisible) {
        setBrowserPanelClosing(false)
      }
      return
    }

    const animationId = browserPanelWidthAnimationIdRef.current + 1
    browserPanelWidthAnimationIdRef.current = animationId
    browserPanelWidthAnimatingRef.current = true
    pauseBrowserNativeBoundsForLayout(true)

    const controls = browserPanelWidth.animateSize(nextWidth, SPRING)
    void controls.finished
      .then(() => {
        if (browserPanelWidthAnimationIdRef.current !== animationId) {
          return
        }
        browserPanelWidthAnimatingRef.current = false
        if (!browserPanelVisible) {
          setBrowserPanelClosing(false)
        }
        resumeBrowserNativeBounds()
      })
      .catch(() => {})
  }, [
    browserPanelRatio,
    browserPanelVisible,
    browserPanelWidth,
    dragging,
    pauseBrowserNativeBoundsForLayout,
    readMainWidth,
    resumeBrowserNativeBounds,
  ])

  useEffect(() => {
    const element = mainElementRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }

    const syncBrowserPanelWidth = () => {
      if (dragging === 'browser' || browserPanelWidthAnimatingRef.current) {
        return
      }
      browserPanelWidth.setSize(browserPanelVisible ? browserPanelRatio * readMainWidth() : 0)
    }

    const resizeObserver = new ResizeObserver(syncBrowserPanelWidth)
    resizeObserver.observe(element)
    window.addEventListener('resize', syncBrowserPanelWidth)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', syncBrowserPanelWidth)
    }
  }, [browserPanelRatio, browserPanelVisible, browserPanelWidth, dragging, readMainWidth])

  useEffect(() => {
    if (browserPanelVisible || browserPanelClosing || browserNativeBoundsPaused) {
      return
    }
    clearBrowserNativeBoundsResumeTimer()
  }, [
    browserNativeBoundsPaused,
    browserPanelClosing,
    browserPanelVisible,
    clearBrowserNativeBoundsResumeTimer,
  ])

  useEffect(() => {
    const initialState = useLayoutStore.getState()
    let previousSidebarCollapsed = initialState.sidebarCollapsed
    let previousAsideOpen = initialState.asideOpen
    return useLayoutStore.subscribe((state) => {
      const sidebarToggled = previousSidebarCollapsed !== state.sidebarCollapsed
      const asideToggled = previousAsideOpen !== state.asideOpen
      previousSidebarCollapsed = state.sidebarCollapsed
      previousAsideOpen = state.asideOpen

      if (!sidebarToggled && !asideToggled) {
        return
      }
      if (dragging === 'browser') {
        return
      }
      pauseBrowserNativeBoundsForLayout()
    })
  }, [dragging, pauseBrowserNativeBoundsForLayout])

  const handleAsideLayoutResizeStart = useCallback(() => {
    pauseBrowserNativeBounds()
  }, [pauseBrowserNativeBounds])
  const handleAsideLayoutResizeEnd = useCallback(() => {
    resumeBrowserNativeBounds()
  }, [resumeBrowserNativeBounds])

  const browserPanelNativeBoundsPaused = browserNativeBoundsPaused || browserPanelClosing
  const browserPanelActivityVisible
    = browserPanelVisible || browserPanelClosing || browserNativeBoundsPaused

  const handleToggleZenSidebars = useCallback(() => {
    const { asideOpen, setAsideOpen, setSidebarCollapsed, sidebarCollapsed }
      = useLayoutStore.getState()
    const shouldCollapse = !sidebarCollapsed && (!canUseRightAside || asideOpen)
    setSidebarCollapsed(shouldCollapse)
    if (canUseRightAside) {
      setAsideOpen(!shouldCollapse)
    }
  }, [canUseRightAside])

  useShortcut(
    'toggle-zen-sidebars',
    { meta: true, key: '.', allowInEditable: true },
    handleToggleZenSidebars,
  )

  useEffect(() => {
    useBrowserPanelStore.getState().setActiveOwner(activeBrowserPanelOwnerId)
    setActiveBrowserPanelOwner(activeBrowserPanelOwnerId)
  }, [activeBrowserPanelOwnerId, setActiveBrowserPanelOwner])

  useEffect(() => {
    if (!isElectron) {
      return
    }
    return installBrowserUseBridge({
      ownerId: activeBrowserPanelOwnerId,
      openBrowserPanel: () => setBrowserPanelOpen(true, activeBrowserPanelOwnerId),
      closeBrowserPanel: () => setBrowserPanelOpen(false, activeBrowserPanelOwnerId),
      readBrowserTabSource,
    })
  }, [activeBrowserPanelOwnerId, readBrowserTabSource, setBrowserPanelOpen])

  return (
    <div className="flex flex-1 flex-col overflow-hidden text-foreground">
      {/* ── Full-width top header — toggle + breadcrumbs ── */}
      <AppHeader
        hasAside={canUseRightAside}
        hasBrowserPanel={resolvedHasBrowserPanel}
        hasPanel={resolvedHasPanel}
        browserPanelOwnerId={activeBrowserPanelOwnerId}
        browserPanelOpen={browserPanelOpen}
        sessionScoped={sessionScoped}
        headerActions={slots.headerActions}
        sidebarInSheet={sidebarInSheet}
        sidebarSheetOpen={sidebarSheetOpen}
        onOpenSidebarSheet={onOpenSidebarSheet}
        onToggleSidebarSheet={onToggleSidebarSheet}
      />

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Center column */}
        <m.div
          ref={registerCenterColumn}
          data-slot="app-center-column"
          className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background rounded-xl shadow-[var(--shadow-sm)] z-10 m-1 mr-2"
          animate={
            jarvisExpanded
              ? { scale: CENTER_COLUMN_EXPANDED_SCALE, y: CENTER_COLUMN_EXPANDED_Y, opacity: 0.6 }
              : { scale: 1, y: 0, opacity: 1 }
          }
          transition={SPRING}
        >
          <main
            ref={mainRef}
            className="flex flex-row flex-1 bg-background overflow-hidden rounded-xl"
          >
            <div className="flex flex-col flex-1 overflow-hidden min-w-0">{children}</div>

            {/* Browser panel split */}
            {browserPanelVisible && (
              <ResizeHandle
                direction="horizontal"
                value={() => browserPanelWidth.size.get()}
                onChange={handleBrowserPanelResize}
                onDragStart={handleBrowserPanelDragStart}
                onChangeEnd={handleBrowserPanelResizeEnd}
                min={() => readMainWidth() * 0.2}
                max={() => readMainWidth() * 0.7}
                inverted
                className="bg-background"
              />
            )}
            <m.div
              initial={false}
              style={{ width: browserPanelWidth.size }}
              className={cn(
                'flex shrink-0 flex-col overflow-hidden',
                browserPanelActivityVisible && 'border-l border-border/50',
              )}
              data-testid="app-layout-browser-panel"
              data-panel-open={browserPanelVisible ? 'true' : 'false'}
            >
              <RetainedBrowserPanels
                active={browserPanelMounted}
                ownerId={activeBrowserPanelOwnerId}
                activeSessionId={activeSessionId}
                activeSessionTitle={activeSessionTitle}
                terminalCwd={resolvedAsideWorkspacePath}
                nativeBoundsPaused={browserPanelNativeBoundsPaused}
                onCloseLastTab={handleCloseLastBrowserPanelTab}
                validOwnerIds={validChromeOwnerIds}
                visible={browserPanelActivityVisible}
              />
            </m.div>
          </main>

          {/* Bottom panel resize handle */}
          {!isSettings && bottomPanelOpen && resolvedHasPanel && (
            <ResizeHandle
              direction="vertical"
              value={bottomPanelHeight}
              onChange={setBottomPanelHeight}
              onDragStart={handleBottomPanelDragStart}
              onDragEnd={handleBottomPanelDragEnd}
              min={PANEL.min}
              max={PANEL.max}
              inverted
              className="bg-background"
            />
          )}
          <m.div
            initial={{
              height: !isSettings && resolvedHasPanel && bottomPanelOpen ? bottomPanelHeight : 0,
              opacity: !isSettings && resolvedHasPanel && bottomPanelOpen ? 1 : 0,
            }}
            animate={{
              height: !isSettings && resolvedHasPanel && bottomPanelOpen ? bottomPanelHeight : 0,
              opacity: !isSettings && resolvedHasPanel && bottomPanelOpen ? 1 : 0,
            }}
            transition={dragging === 'panel' ? INSTANT : SPRING}
            className={cn(
              'bg-background overflow-hidden shrink-0',
              !isSettings && resolvedHasPanel && 'border-t border-border',
            )}
            data-testid="app-layout-bottom-panel"
            data-panel-open={!isSettings && resolvedHasPanel && bottomPanelOpen ? 'true' : 'false'}
          >
            <div style={{ height: bottomPanelHeight }}>
              <RetainedBottomPanels
                active={!isSettings && !!resolvedHasPanel}
                ownerId={activeChromeOwnerId}
                panel={resolvedPanel}
                validOwnerIds={validChromeOwnerIds}
                visible={!isSettings && !!resolvedHasPanel && bottomPanelOpen}
              />
            </div>
          </m.div>
        </m.div>

        {/* Right Aside — layout-owned, independent of tab lifecycle */}
        <AppRightAside
          ownerId={activeChromeOwnerId}
          enabled={canUseRightAside}
          sessionId={resolvedAsideSessionId}
          workspaceId={resolvedAsideWorkspaceId}
          workspaceName={resolvedAsideWorkspaceName}
          workspacePath={resolvedAsideWorkspacePath}
          validOwnerIds={validChromeOwnerIds}
          onResizeStart={handleAsideLayoutResizeStart}
          onResizeEnd={handleAsideLayoutResizeEnd}
        />
      </div>

      {/* Footer */}
      {showFooter && <AppFooter />}
      {showFooter && import.meta.env.DEV && <DevBottomBar />}
    </div>
  )
}

interface AppRightAsideProps {
  enabled: boolean
  ownerId: string | null
  sessionId?: string | null
  validOwnerIds?: readonly string[]
  workspaceId?: string | null
  workspaceName?: string | null
  workspacePath?: string | null
  onResizeStart?: () => void
  onResizeEnd?: () => void
}

const AppRightAside = memo(
  ({
    enabled,
    ownerId,
    sessionId,
    validOwnerIds,
    workspaceId,
    workspaceName,
    workspacePath,
    onResizeStart,
    onResizeEnd,
  }: AppRightAsideProps) => {
    const asideWidth = useLayoutStore(state => state.asideWidth)
    const setAsideWidth = useLayoutStore(state => state.setAsideWidth)
    const asideOpen = useLayoutStore(state => state.asideOpen)
    const asideVisible = enabled && asideOpen
    const asideMotionWidth = useAnimatedSize(asideVisible ? asideWidth : 0)
    const asideAnimationIdRef = useRef(0)
    const previousEnabledRef = useRef(enabled)

    const handleAsideResize = useCallback(
      (width: number) => {
        asideMotionWidth.setSize(width)
      },
      [asideMotionWidth],
    )
    const handleAsideResizeStart = useCallback(() => {
      asideMotionWidth.setSize(asideMotionWidth.size.get())
      onResizeStart?.()
    }, [asideMotionWidth, onResizeStart])
    const handleAsideResizeEnd = useCallback(
      (width: number) => {
        asideMotionWidth.setSize(width)
        setAsideWidth(width)
        onResizeEnd?.()
      },
      [asideMotionWidth, onResizeEnd, setAsideWidth],
    )

    useLayoutEffect(() => {
      const nextWidth = asideVisible ? asideWidth : 0
      if (Math.abs(asideMotionWidth.size.get() - nextWidth) < 0.5) {
        previousEnabledRef.current = enabled
        return
      }
      const enabledChanged = previousEnabledRef.current !== enabled
      previousEnabledRef.current = enabled
      if (!enabled || enabledChanged) {
        asideAnimationIdRef.current += 1
        asideMotionWidth.setSize(nextWidth)
        return
      }
      const animationId = asideAnimationIdRef.current + 1
      asideAnimationIdRef.current = animationId
      const controls = asideMotionWidth.animateSize(nextWidth, SPRING)
      void controls.finished.catch(() => undefined)
    }, [asideMotionWidth, asideVisible, asideWidth, enabled])

    useEffect(() => {
      if (!enabled || !ownerId) {
        return
      }
      void loadRightAside()
    }, [enabled, ownerId])

    return (
      <>
        {asideVisible && (
          <ResizeHandle
            direction="horizontal"
            value={() => asideMotionWidth.size.get()}
            onChange={handleAsideResize}
            onDragStart={handleAsideResizeStart}
            onChangeEnd={handleAsideResizeEnd}
            min={ASIDE.min}
            max={ASIDE.max}
            inverted
          />
        )}
        <m.aside
          initial={false}
          animate={{ opacity: asideVisible ? 1 : 0 }}
          transition={SPRING}
          style={{ width: asideMotionWidth.size }}
          className="flex shrink-0 overflow-hidden bg-sidebar"
          data-testid="app-layout-right-aside"
          data-aside-open={asideVisible ? 'true' : 'false'}
          data-aside-enabled={enabled ? 'true' : 'false'}
          aria-hidden={asideVisible ? undefined : 'true'}
        >
          <m.div className="flex flex-col flex-1 overflow-hidden" style={{ width: asideWidth }}>
            <RetainedRightAsides
              acceptCurrentOwner={enabled}
              ownerId={ownerId}
              sessionId={sessionId ?? null}
              validOwnerIds={validOwnerIds}
              visible={asideVisible}
              workspaceId={workspaceId ?? null}
              workspaceName={workspaceName ?? null}
              workspacePath={workspacePath ?? null}
            />
          </m.div>
        </m.aside>
      </>
    )
  },
)
AppRightAside.displayName = 'AppRightAside'
