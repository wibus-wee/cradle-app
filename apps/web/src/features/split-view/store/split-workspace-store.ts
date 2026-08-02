import type { SerializedDockview } from 'dockview-react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'

import type { SurfaceRoute } from '~/navigation/surface-identity'
import { surfaceIdForRoute } from '~/navigation/surface-identity'
import { useSurfaceStore } from '~/navigation/surface-store'
import { persistStorage } from '~/store/persist-storage'

/**
 * One pane of a split workspace. A pane is just a route: anything the app can
 * show as a tab can equally be shown as a pane, which is what makes the split
 * view universal instead of chat-specific. The route is also the pane's
 * identity, so the same interface can never be opened twice in one workspace.
 */
export interface SplitPane {
  id: string
  route: SurfaceRoute
}

/**
 * Split state of a single surface (top-level tab).
 *
 * `primaryPaneId` is the pane bound to the surface's own route: it renders the
 * router outlet, follows the URL, and can never be closed — closing it means
 * closing the surface. Every other pane is a route opened beside it.
 *
 * Geometry lives in `layout`, dockview's own serialized grid. This store owns
 * which routes are on screen and which one has focus; dockview owns where they
 * sit and how big they are.
 */
export interface SplitWorkspace {
  primaryPaneId: string
  panes: Record<string, SplitPane>
  focusedPaneId: string
  layout: SerializedDockview | null
}

interface SplitWorkspaceStoreState {
  workspaces: Record<string, SplitWorkspace>
  ensureWorkspace: (surfaceId: string, route: SurfaceRoute) => void
  /**
   * Record a pane before dockview mounts its panel — the panel component reads
   * its route back out of this store, so the record has to exist first.
   * Returns the pane id, or `null` when the route is already on screen.
   */
  registerPane: (surfaceId: string, route: SurfaceRoute) => string | null
  /** Replace a secondary pane's route without changing its instance identity. */
  updatePaneRoute: (surfaceId: string, paneId: string, route: SurfaceRoute) => void
  forgetPane: (surfaceId: string, paneId: string) => void
  focusPane: (surfaceId: string, paneId: string) => void
  setLayout: (surfaceId: string, layout: SerializedDockview | null) => void
  pruneWorkspace: (surfaceId: string) => void
}

const STORAGE_KEY = 'cradle:split-workspaces:v1'
/** Chat-only predecessor of this store; its layouts are not portable. */
const LEGACY_STORAGE_KEY = 'cradle:chat-split-workspaces:v1'

let localPaneId = 0

function createPaneId(route: SurfaceRoute): string {
  const resourceId = surfaceIdForRoute(route)
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) {
    return `pane:${resourceId}:${uuid}`
  }
  localPaneId += 1
  return `pane:${resourceId}:${Date.now().toString(36)}-${localPaneId.toString(36)}`
}

function createWorkspace(route: SurfaceRoute): SplitWorkspace {
  const paneId = surfaceIdForRoute(route)
  return {
    primaryPaneId: paneId,
    panes: { [paneId]: { id: paneId, route } },
    focusedPaneId: paneId,
    layout: null,
  }
}

function sameRoute(left: SurfaceRoute, right: SurfaceRoute): boolean {
  return left.to === right.to
    && JSON.stringify(left.params ?? null) === JSON.stringify(right.params ?? null)
    && JSON.stringify(left.search ?? null) === JSON.stringify(right.search ?? null)
}

/**
 * Bring a persisted workspace back in line with the surface it belongs to.
 * Anything inconsistent collapses to a fresh single-pane workspace rather than
 * restoring half a layout.
 */
function reconcileWorkspace(workspace: SplitWorkspace, route: SurfaceRoute): SplitWorkspace {
  const primaryPaneId = surfaceIdForRoute(route)
  const primaryPane = workspace.panes[primaryPaneId]
  if (workspace.primaryPaneId !== primaryPaneId || !primaryPane) {
    return createWorkspace(route)
  }

  // The primary pane mirrors the surface's live route: search params can
  // change without changing surface identity.
  if (sameRoute(primaryPane.route, route)) {
    return workspace
  }
  return {
    ...workspace,
    panes: { ...workspace.panes, [primaryPaneId]: { id: primaryPaneId, route } },
  }
}

export const useSplitWorkspaceStore = create<SplitWorkspaceStoreState>()(
  persist(
    set => ({
      workspaces: {},

      ensureWorkspace: (surfaceId, route) =>
        set((state) => {
          const existing = state.workspaces[surfaceId]
          const next = existing ? reconcileWorkspace(existing, route) : createWorkspace(route)
          return next === existing ? state : { workspaces: { ...state.workspaces, [surfaceId]: next } }
        }),

      registerPane: (surfaceId, route) => {
        let registered: string | null = null
        set((state) => {
          const existing = state.workspaces[surfaceId]
          if (!existing || Object.values(existing.panes).some(pane => sameRoute(pane.route, route))) {
            return state
          }
          const paneId = createPaneId(route)
          registered = paneId
          return {
            workspaces: {
              ...state.workspaces,
              [surfaceId]: {
                ...existing,
                panes: { ...existing.panes, [paneId]: { id: paneId, route } },
                focusedPaneId: paneId,
              },
            },
          }
        })
        return registered
      },

      updatePaneRoute: (surfaceId, paneId, route) =>
        set((state) => {
          const workspace = state.workspaces[surfaceId]
          const pane = workspace?.panes[paneId]
          if (!workspace || !pane || paneId === workspace.primaryPaneId || sameRoute(pane.route, route)) {
            return state
          }
          return {
            workspaces: {
              ...state.workspaces,
              [surfaceId]: {
                ...workspace,
                panes: {
                  ...workspace.panes,
                  [paneId]: { ...pane, route },
                },
              },
            },
          }
        }),

      forgetPane: (surfaceId, paneId) =>
        set((state) => {
          const existing = state.workspaces[surfaceId]
          if (!existing || paneId === existing.primaryPaneId || !existing.panes[paneId]) {
            return state
          }
          const { [paneId]: _removed, ...panes } = existing.panes
          const paneCount = Object.keys(panes).length
          return {
            workspaces: {
              ...state.workspaces,
              [surfaceId]: {
                ...existing,
                panes,
                focusedPaneId: existing.focusedPaneId === paneId ? existing.primaryPaneId : existing.focusedPaneId,
                // A single-pane workspace has no meaningful grid to restore.
                layout: paneCount <= 1 ? null : existing.layout,
              },
            },
          }
        }),

      focusPane: (surfaceId, paneId) =>
        set((state) => {
          const existing = state.workspaces[surfaceId]
          if (!existing || existing.focusedPaneId === paneId || !existing.panes[paneId]) {
            return state
          }
          return {
            workspaces: { ...state.workspaces, [surfaceId]: { ...existing, focusedPaneId: paneId } },
          }
        }),

      setLayout: (surfaceId, layout) =>
        set((state) => {
          const existing = state.workspaces[surfaceId]
          if (!existing) {
            return state
          }
          return { workspaces: { ...state.workspaces, [surfaceId]: { ...existing, layout } } }
        }),

      pruneWorkspace: surfaceId =>
        set((state) => {
          if (!(surfaceId in state.workspaces)) {
            return state
          }
          const { [surfaceId]: _removed, ...rest } = state.workspaces
          return { workspaces: rest }
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: persistStorage,
      partialize: state => ({ workspaces: state.workspaces }),
    },
  ),
)

try {
  globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY)
}
catch {
  // Storage is unavailable in tests / restricted environments.
}

/** Garbage-collect split layouts once their owning surface (tab) closes. */
useSurfaceStore.subscribe((state) => {
  const validSurfaceIds = new Set(state.surfaces.map(surface => surface.id))
  const { workspaces, pruneWorkspace } = useSplitWorkspaceStore.getState()
  for (const surfaceId of Object.keys(workspaces)) {
    if (!validSurfaceIds.has(surfaceId)) {
      pruneWorkspace(surfaceId)
    }
  }
})

export function readSplitWorkspace(surfaceId: string): SplitWorkspace | undefined {
  return useSplitWorkspaceStore.getState().workspaces[surfaceId]
}

export function readSplitPaneByRoute(surfaceId: string, route: SurfaceRoute): SplitPane | null {
  const workspace = readSplitWorkspace(surfaceId)
  return Object.values(workspace?.panes ?? {}).find(pane => sameRoute(pane.route, route)) ?? null
}

export function isSplitWorkspace(workspace: SplitWorkspace | undefined): boolean {
  return !!workspace && Object.keys(workspace.panes).length > 1
}

export function useSplitPane(surfaceId: string, paneId: string): SplitPane | null {
  return useSplitWorkspaceStore(state => state.workspaces[surfaceId]?.panes[paneId] ?? null)
}

/**
 * Pane the app chrome (aside, bottom panel, breadcrumb) should follow. Only
 * meaningful once a surface has more than one pane — otherwise the surface's
 * own route already describes what is on screen.
 */
export function useFocusedSplitPane(surfaceId: string | null): SplitPane | null {
  return useSplitWorkspaceStore((state) => {
    if (!surfaceId) {
      return null
    }
    const workspace = state.workspaces[surfaceId]
    if (!workspace || !isSplitWorkspace(workspace)) {
      return null
    }
    return workspace.panes[workspace.focusedPaneId] ?? null
  })
}

/**
 * Routes of every pane on screen for a surface, so the layout-slot scope can
 * cover each pane's chrome instead of only the primary route's.
 */
export function useSplitPaneRoutes(surfaceId: string | null): readonly SurfaceRoute[] {
  return useSplitWorkspaceStore(
    useShallow((state) => {
      if (!surfaceId) {
        return EMPTY_ROUTES
      }
      const workspace = state.workspaces[surfaceId]
      if (!workspace || !isSplitWorkspace(workspace)) {
        return EMPTY_ROUTES
      }
      return Object.values(workspace.panes).map(pane => pane.route)
    }),
  )
}

const EMPTY_ROUTES: readonly SurfaceRoute[] = []
