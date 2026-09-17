import { getI18n } from '~/i18n/instance'

import type { SurfaceKind, SurfaceRoute } from './surface-route-codec'
import {
  HOME_SURFACE_ID,
  pullRequestsSurfaceId,
  surfaceIdForRoute,
  surfaceKindForRoute,
  surfaceRouteFromLocation,
  workSurfaceId,
} from './surface-route-codec'

export type { SurfaceKind, SurfaceRoute } from './surface-route-codec'
export {
  chatSurfaceId,
  diffSurfaceId,
  HOME_SURFACE_ID,
  isSurfaceKindPersistable,
  kanbanSurfaceId,
  parseSurfaceRoute,
  pluginSurfaceId,
  pullRequestsSurfaceId,
  surfaceIdForRoute,
  surfaceKindForRoute,
  surfaceRouteNavigateOptions,
  workspaceDiffsSurfaceId,
  workspaceSurfaceId,
  workSurfaceId,
} from './surface-route-codec'

export interface AppSurface {
  id: string
  kind: SurfaceKind
  title: string
  route: SurfaceRoute
  order: number
  closable: boolean
}

export interface SurfaceDraft {
  id: string
  kind: SurfaceKind
  title: string
  route: SurfaceRoute
  closable: boolean
}

export const HOME_SURFACE: AppSurface = {
  id: HOME_SURFACE_ID,
  kind: 'home',
  title: 'Home',
  route: { to: '/' },
  order: 0,
  closable: false,
}

export function createHomeSurfaceDraft(): SurfaceDraft {
  return {
    id: HOME_SURFACE.id,
    kind: HOME_SURFACE.kind,
    title: getI18n().t('chrome:surface.home'),
    route: HOME_SURFACE.route,
    closable: HOME_SURFACE.closable,
  }
}

/**
 * Surface titles are presentation metadata, not part of route identity —
 * they resolve at draft time and may be replaced later by live resource data
 * (e.g. chat session titles) via `updateSurfaceTitle`.
 */
const SURFACE_TITLES: Record<SurfaceKind, () => string> = {
  'home': () => getI18n().t('chrome:surface.home'),
  'new-work': () => getI18n().t('work:surface.new'),
  'work': () => getI18n().t('work:surface.work'),
  'pull-requests': () => getI18n().t('pull-requests:surface.title'),
  'new-chat': () => getI18n().t('chrome:surface.newChat'),
  'chat': () => 'Chat',
  'diff': () => 'Cradle Diffs',
  'workspace': () => 'Workspace',
  'workspace-diffs': () => 'Cradle Diffs',
  'kanban': () => getI18n().t('chrome:surface.kanban'),
  'plugin': () => getI18n().t('settings:plugins.panel.fallbackTitle'),
  'plugin-center': () => getI18n().t('settings:plugins.center.title'),
  'awaits': () => 'Awaits',
  'automation': () => 'Automations',
  'usage': () => getI18n().t('chrome:surface.usage'),
  'settings': () => 'Settings',
  'onboarding': () => 'Onboarding',
  'devtool': () => 'Devtool',
}

/**
 * Router-state → surface draft: the codec decodes the canonical route, and
 * this module decorates it with surface identity (id, kind) and presentation
 * metadata (title). Unknown or malformed locations produce no draft.
 */
export function surfaceDraftFromRoute(input: {
  pathname: string
  params?: Record<string, unknown>
  search?: Record<string, unknown>
}): SurfaceDraft | null {
  const route = surfaceRouteFromLocation(input)
  if (!route) {
    return null
  }
  if (route.to === '/') {
    return createHomeSurfaceDraft()
  }

  const kind = surfaceKindForRoute(route)
  return {
    id: surfaceIdForRoute(route),
    kind,
    title: SURFACE_TITLES[kind](),
    route,
    closable: true,
  }
}

export function layoutSlotIdForRoute(route: SurfaceRoute | null | undefined): string | null {
  if (!route) {
    return null
  }

  if (route.to === '/chat/$sessionId') {
    return route.params.sessionId
  }

  if (route.to === '/work/$workId') {
    return workSurfaceId(route.params.workId)
  }

  if (route.to === '/pull-requests') {
    return pullRequestsSurfaceId()
  }

  if (route.to === '/workspaces/$workspaceId') {
    return `workspace-detail:${route.params.workspaceId}`
  }

  if (route.to === '/workspaces/$workspaceId/diffs') {
    return `workspace-diffs:${route.params.workspaceId}`
  }

  if (route.to === '/diff') {
    return 'diff'
  }

  if (route.to === '/chat/new') {
    return 'new-chat'
  }

  if (route.to === '/work/new') {
    return 'new-work'
  }

  return null
}

export function layoutSlotIdForSurface(surface: Pick<AppSurface, 'kind' | 'route'> | null | undefined): string | null {
  if (!surface) {
    return null
  }
  return layoutSlotIdForRoute(surface.route)
}

export function chatSessionIdForSurface(surface: Pick<AppSurface, 'kind' | 'route'> | null | undefined): string | null {
  if (surface?.kind === 'chat' && surface.route.to === '/chat/$sessionId') {
    return surface.route.params.sessionId
  }

  return null
}

export function workIdForSurface(surface: Pick<AppSurface, 'kind' | 'route'> | null | undefined): string | null {
  if (surface?.kind === 'work' && surface.route.to === '/work/$workId') {
    return surface.route.params.workId
  }
  return null
}

export function workspaceIdForSurface(surface: Pick<AppSurface, 'kind' | 'route'> | null | undefined): string | null {
  if (surface?.kind === 'workspace' && surface.route.to === '/workspaces/$workspaceId') {
    return surface.route.params.workspaceId
  }

  if (surface?.kind === 'workspace-diffs' && surface.route.to === '/workspaces/$workspaceId/diffs') {
    return surface.route.params.workspaceId
  }

  if (surface?.kind === 'diff' && surface.route.to === '/diff') {
    return surface.route.search?.workspace ?? null
  }

  return null
}

export function sortSurfaces(surfaces: readonly AppSurface[]): AppSurface[] {
  return [...surfaces].sort((left, right) => left.order - right.order)
}
