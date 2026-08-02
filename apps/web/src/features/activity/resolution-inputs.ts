import { isSplitWorkspace, useSplitWorkspaceStore } from '~/features/split-view/store/split-workspace-store'
import { readActiveSurface } from '~/navigation/active-surface'
import type { SurfaceDraft, SurfaceRoute } from '~/navigation/surface-identity'
import type { BrowserPanelTab } from '~/store/browser-panel'
import { useBrowserPanelStore } from '~/store/browser-panel'

import { resolveUiActivityEntity } from './entity-resolver'
import type { ResolvedUiActivityEntity } from './types'

export interface UiActivityResolutionInputs {
  visible: boolean
  activeBrowserTab: BrowserPanelTab | null
  focusedSplitRoute: SurfaceRoute | null
  activeSurface: SurfaceDraft | null
  resolved: ResolvedUiActivityEntity | null
}

function readActiveBrowserTab(): BrowserPanelTab | null {
  const state = useBrowserPanelStore.getState()
  if (!state.open || !state.activeTabId) {
    return null
  }
  return state.tabs.find(tab => tab.id === state.activeTabId) ?? null
}

function safeReadActiveSurface(): SurfaceDraft | null {
  try {
    return readActiveSurface()
  }
  catch {
    return null
  }
}

function readFocusedSplitRoute(): SurfaceRoute | null {
  const surface = safeReadActiveSurface()
  if (!surface) {
    return null
  }
  const workspace = useSplitWorkspaceStore.getState().workspaces[surface.id]
  if (!workspace || !isSplitWorkspace(workspace)) {
    return null
  }
  const focused = workspace.panes[workspace.focusedPaneId]
  return focused?.route ?? null
}

export function readUiActivityResolutionInputs(): UiActivityResolutionInputs {
  const visible = typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  const activeBrowserTab = readActiveBrowserTab()
  const focusedSplitRoute = readFocusedSplitRoute()
  const activeSurface = safeReadActiveSurface()

  return {
    visible,
    activeBrowserTab,
    focusedSplitRoute,
    activeSurface,
    resolved: visible
      ? resolveUiActivityEntity({
          activeBrowserTab,
          focusedSplitRoute,
          activeSurface,
        })
      : null,
  }
}

export function formatSurfaceRoute(route: SurfaceRoute | null): string {
  if (!route) {
    return '(none)'
  }
  const params = 'params' in route && route.params
    ? ` ${JSON.stringify(route.params)}`
    : ''
  return `${route.to}${params}`
}

export function formatBrowserTabLabel(tab: BrowserPanelTab | null): string {
  if (!tab) {
    return '(none)'
  }
  if (tab.kind === 'workspace-file') {
    return tab.path
  }
  if (tab.kind === 'workspace-diff') {
    return tab.paths?.[0] ?? tab.repositoryPath ?? tab.id
  }
  return `${tab.kind}:${tab.id}`
}
