import type { DockviewGroupPanel } from 'dockview-react'

import type { SurfaceRoute } from '~/navigation/surface-identity'

import { clearSplitDropHover } from './dnd/split-drop-hover'
import type { SplitDropPoint } from './dnd/split-drop-target'
import { resolveSplitDropTarget } from './dnd/split-drop-target'
import type { SplitDirection } from './model/split-direction'
import { getSplitDockviewApi } from './runtime/split-dockview-registry'
import { addSplitPanel } from './runtime/split-panels'
import {
  isSplitWorkspace,
  readSplitPaneByRoute,
  readSplitWorkspace,
  useSplitWorkspaceStore,
} from './store/split-workspace-store'

/**
 * Imperative entry points into the split view, for callers outside the split
 * component tree: the surface bar, sidebar drag sources and global keyboard
 * commands.
 */

/**
 * Open `route` as a split pane inside a surface. Registers the pane in the
 * store first (so the panel component can resolve its route), then adds the
 * dockview panel. Returns `false` when the route is already on screen or the
 * surface has no live dock.
 */
export function openRouteInSplit(
  surfaceId: string,
  input: { route: SurfaceRoute, direction: SplitDirection, referenceGroup?: DockviewGroupPanel },
): boolean {
  const store = useSplitWorkspaceStore.getState()
  const api = getSplitDockviewApi(surfaceId)
  if (!api) {
    return false
  }

  const paneId = store.registerPane(surfaceId, input.route)
  if (!paneId) {
    // Already open — surface it instead of stacking a duplicate.
    const existingPane = readSplitPaneByRoute(surfaceId, input.route)
    if (existingPane) {
      api.getPanel(existingPane.id)?.api.setActive()
    }
    return false
  }

  const added = addSplitPanel(api, paneId, input.direction, input.referenceGroup)
  if (!added) {
    store.forgetPane(surfaceId, paneId)
    return false
  }
  return true
}

/**
 * Resolve the surface under the pointer and split the dragged route into it.
 * Returns `false` when the release did not land on a splittable surface, so
 * the caller can fall back to its own drop behaviour (reorder, tear-off).
 */
export function dropSurfaceRouteAtPoint(point: SplitDropPoint): boolean {
  clearSplitDropHover()

  const target = resolveSplitDropTarget(point)
  if (!target) {
    return false
  }
  return openRouteInSplit(target.surfaceId, {
    route: point.route,
    direction: target.direction,
    referenceGroup: target.referenceGroup,
  })
}

export function focusSplitPane(surfaceId: string, paneId: string): void {
  useSplitWorkspaceStore.getState().focusPane(surfaceId, paneId)
}

/** Replace the route rendered by one secondary pane while preserving its layout slot. */
export function replaceSplitPaneRoute(
  surfaceId: string,
  paneId: string,
  route: SurfaceRoute,
): boolean {
  const workspace = readSplitWorkspace(surfaceId)
  if (!workspace || paneId === workspace.primaryPaneId || !workspace.panes[paneId]) {
    return false
  }
  useSplitWorkspaceStore.getState().updatePaneRoute(surfaceId, paneId, route)
  return true
}

/** Close a specific secondary pane through Dockview so layout and store stay in sync. */
export function closeSplitPaneById(surfaceId: string, paneId: string): boolean {
  const workspace = readSplitWorkspace(surfaceId)
  if (!workspace || paneId === workspace.primaryPaneId || !workspace.panes[paneId]) {
    return false
  }
  const api = getSplitDockviewApi(surfaceId)
  const panel = api?.getPanel(paneId)
  if (!api || !panel) {
    return false
  }
  api.removePanel(panel)
  return true
}

/**
 * VS Code-style Cmd+W: close the focused pane before the whole tab. Returns
 * `false` when the surface is down to its primary pane, the caller's signal to
 * close the surface itself.
 */
export function closeFocusedSplitPane(surfaceId: string): boolean {
  const workspace = readSplitWorkspace(surfaceId)
  if (!workspace || !isSplitWorkspace(workspace) || workspace.focusedPaneId === workspace.primaryPaneId) {
    return false
  }
  return closeSplitPaneById(surfaceId, workspace.focusedPaneId)
}
