import type { SurfaceDraft, SurfaceRoute } from '~/navigation/surface-identity'
import { pluginSurfaceId } from '~/navigation/surface-identity'
import type { BrowserPanelTab } from '~/store/browser-panel'

import type { ResolvedUiActivityEntity, UiActivityEntityType } from './types'

export interface UiActivityEntitySources {
  /** Active browser-panel tab when the panel is open; otherwise null. */
  activeBrowserTab: BrowserPanelTab | null
  /** Focused split-pane route when it differs from the surface primary route. */
  focusedSplitRoute: SurfaceRoute | null
  /** Active surface draft from the router (primary route). */
  activeSurface: SurfaceDraft | null
}

function entityFromSurfaceRoute(route: SurfaceRoute): ResolvedUiActivityEntity | null {
  switch (route.to) {
    case '/chat/$sessionId':
      return { entity: `chat:${route.params.sessionId}`, entityType: 'chat' }
    case '/work/$workId':
      return { entity: `work:${route.params.workId}`, entityType: 'work' }
    case '/pull-requests': {
      const workId = route.search?.workId
      if (workId) {
        return { entity: `pr:${workId}`, entityType: 'pr' }
      }
      return { entity: 'app:pull-requests', entityType: 'app' }
    }
    case '/settings/$section':
      return { entity: `settings:${route.params.section}`, entityType: 'settings' }
    case '/kanban/$boardId':
      return { entity: `kanban:${route.params.boardId}`, entityType: 'kanban' }
    case '/plugins/$routeSegment/$localId':
      return {
        entity: pluginSurfaceId(route.params.routeSegment, route.params.localId),
        entityType: 'plugin',
      }
    case '/workspaces/$workspaceId':
      return { entity: `workspace:${route.params.workspaceId}`, entityType: 'app' }
    case '/':
      return { entity: 'app:home', entityType: 'app' }
    case '/chat/new':
      return { entity: 'app:new-chat', entityType: 'app' }
    case '/work/new':
      return { entity: 'app:new-work', entityType: 'app' }
    case '/plugins':
      return { entity: 'app:plugin-center', entityType: 'app' }
    case '/awaits':
      return { entity: 'app:awaits', entityType: 'app' }
    case '/automation':
      return { entity: 'app:automation', entityType: 'app' }
    case '/usage':
      return { entity: 'app:usage', entityType: 'app' }
    case '/onboarding':
      return { entity: 'app:onboarding', entityType: 'app' }
    case '/devtool':
      return { entity: 'app:devtool', entityType: 'app' }
    case '/diff':
      return { entity: 'app:diff', entityType: 'app' }
    case '/workspaces/$workspaceId/diffs':
      return { entity: 'app:workspace-diffs', entityType: 'app' }
    default:
      return null
  }
}

function entityFromSurfaceKind(kind: string): ResolvedUiActivityEntity {
  return { entity: `app:${kind}`, entityType: 'app' }
}

export function resolveEntityFromBrowserTab(
  tab: BrowserPanelTab,
): ResolvedUiActivityEntity | null {
  switch (tab.kind) {
    case 'workspace-file':
      return { entity: tab.path, entityType: 'file' }
    case 'workspace-diff': {
      const path = tab.paths?.[0] ?? tab.repositoryPath ?? tab.id
      return { entity: `diff:${path}`, entityType: 'diff' }
    }
    case 'pull-request': {
      const id = tab.workId ?? `${tab.owner}/${tab.repo}#${tab.number}`
      return { entity: `pr:${id}`, entityType: 'pr' }
    }
    default:
      return null
  }
}

function routesEqual(a: SurfaceRoute, b: SurfaceRoute): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Resolve the current UI activity entity.
 * Preference: browser-panel tab → focused split pane → active surface route.
 */
export function resolveUiActivityEntity(
  sources: UiActivityEntitySources,
): ResolvedUiActivityEntity | null {
  if (sources.activeBrowserTab) {
    const fromTab = resolveEntityFromBrowserTab(sources.activeBrowserTab)
    if (fromTab) {
      return fromTab
    }
  }

  if (
    sources.focusedSplitRoute
    && sources.activeSurface
    && !routesEqual(sources.focusedSplitRoute, sources.activeSurface.route)
  ) {
    const fromSplit = entityFromSurfaceRoute(sources.focusedSplitRoute)
    if (fromSplit) {
      return fromSplit
    }
  }

  if (sources.activeSurface) {
    return entityFromSurfaceRoute(sources.activeSurface.route)
      ?? entityFromSurfaceKind(sources.activeSurface.kind)
  }

  return null
}

export function isUiActivityEntityType(value: string): value is UiActivityEntityType {
  return (
    value === 'chat'
    || value === 'file'
    || value === 'settings'
    || value === 'pr'
    || value === 'diff'
    || value === 'kanban'
    || value === 'plugin'
    || value === 'work'
    || value === 'app'
  )
}
