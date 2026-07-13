import { getI18n } from '~/i18n/instance'

export type SurfaceKind
  = | 'home'
    | 'new-work'
    | 'work'
    | 'pull-requests'
    | 'new-chat'
    | 'chat'
    | 'diff'
    | 'workspace'
    | 'workspace-diffs'
    | 'kanban'
    | 'plugin'
    | 'plugin-center'
    | 'awaits'
    | 'automation'
    | 'usage'
    | 'settings'
    | 'onboarding'
    | 'devtool'

export type SurfaceRoute
  = | { to: '/', params?: undefined, search?: undefined }
    | { to: '/work/new', params?: undefined, search?: { workspaceId?: string, issueId?: string } }
    | { to: '/work/$workId', params: { workId: string }, search?: undefined }
    | { to: '/pull-requests', params?: undefined, search?: { workId?: string } }
    | { to: '/chat/new', params?: undefined, search?: { issueId?: string } }
    | { to: '/chat/$sessionId', params: { sessionId: string }, search?: undefined }
    | { to: '/diff', params?: undefined, search?: { workspace?: string, repo?: string, path?: string, review?: string, view?: 'commit' | 'guide' } }
    | { to: '/workspaces/$workspaceId', params: { workspaceId: string }, search?: undefined }
    | { to: '/workspaces/$workspaceId/diffs', params: { workspaceId: string }, search?: { repo?: string, path?: string, review?: string, view?: 'commit' | 'guide' } }
    | { to: '/kanban/$boardId', params: { boardId: string }, search?: { issue?: string, milestoneId?: string } }
    | { to: '/plugins/$routeSegment/$localId', params: { routeSegment: string, localId: string }, search?: undefined }
    | { to: '/plugins', params?: undefined, search?: undefined }
    | { to: '/awaits', params?: undefined, search?: undefined }
    | { to: '/automation', params?: undefined, search?: undefined }
    | { to: '/usage', params?: undefined, search?: undefined }
    | { to: '/settings/$section', params: { section: string }, search?: undefined }
    | { to: '/onboarding', params?: undefined, search?: undefined }
    | { to: '/devtool', params?: undefined, search?: undefined }

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

export const HOME_SURFACE_ID = 'home'

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

export function chatSurfaceId(sessionId: string): string {
  return `chat:${sessionId}`
}

export function workSurfaceId(workId: string): string {
  return `work:${workId}`
}

export function pullRequestsSurfaceId(): string {
  return 'pull-requests'
}

export function workspaceSurfaceId(workspaceId: string): string {
  return `workspace:${workspaceId}`
}

export function workspaceDiffsSurfaceId(workspaceId: string): string {
  return `workspace-diffs:${workspaceId}`
}

export function diffSurfaceId(): string {
  return 'diff'
}

export function kanbanSurfaceId(boardId: string): string {
  return `kanban:${boardId}`
}

export function pluginSurfaceId(routeSegment: string, localId: string): string {
  return `plugin:${routeSegment}:${localId}`
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function surfaceDraftFromRoute(input: {
  pathname: string
  params?: Record<string, unknown>
  search?: Record<string, unknown>
}): SurfaceDraft | null {
  const params = input.params ?? {}
  const search = input.search ?? {}

  if (input.pathname === '/' || input.pathname === '/home') {
    return createHomeSurfaceDraft()
  }

  if (input.pathname === '/chat/new') {
    return {
      id: 'new-chat',
      kind: 'new-chat',
      title: getI18n().t('chrome:surface.newChat'),
      route: { to: '/chat/new' },
      closable: true,
    }
  }

  if (input.pathname === '/work/new') {
    return {
      id: 'new-work',
      kind: 'new-work',
      title: getI18n().t('work:surface.new'),
      route: {
        to: '/work/new',
        search: {
          workspaceId: readString(search.workspaceId),
          issueId: readString(search.issueId),
        },
      },
      closable: true,
    }
  }

  if (input.pathname === '/pull-requests') {
    return {
      id: pullRequestsSurfaceId(),
      kind: 'pull-requests',
      title: getI18n().t('pull-requests:surface.title'),
      route: {
        to: '/pull-requests',
        search: { workId: readString(search.workId) },
      },
      closable: true,
    }
  }

  const workId = readString(params.workId)
  if (input.pathname.startsWith('/work/') && workId) {
    return {
      id: workSurfaceId(workId),
      kind: 'work',
      title: getI18n().t('work:surface.work'),
      route: { to: '/work/$workId', params: { workId } },
      closable: true,
    }
  }

  const sessionId = readString(params.sessionId)
  if (input.pathname.startsWith('/chat/') && sessionId) {
    return {
      id: chatSurfaceId(sessionId),
      kind: 'chat',
      title: 'Chat',
      route: { to: '/chat/$sessionId', params: { sessionId } },
      closable: true,
    }
  }

  const workspaceId = readString(params.workspaceId)
  if (input.pathname === '/diff') {
    const view = search.view === 'commit' || search.view === 'guide' ? search.view : undefined
    return {
      id: diffSurfaceId(),
      kind: 'diff',
      title: 'Cradle Diffs',
      route: {
        to: '/diff',
        search: {
          workspace: readString(search.workspace),
          repo: readString(search.repo),
          path: readString(search.path),
          review: readString(search.review),
          view,
        },
      },
      closable: true,
    }
  }

  if (input.pathname.startsWith('/workspaces/') && input.pathname.endsWith('/diffs') && workspaceId) {
    const view = search.view === 'commit' || search.view === 'guide' ? search.view : undefined
    return {
      id: workspaceDiffsSurfaceId(workspaceId),
      kind: 'workspace-diffs',
      title: 'Cradle Diffs',
      route: {
        to: '/workspaces/$workspaceId/diffs',
        params: { workspaceId },
        search: {
          repo: readString(search.repo),
          path: readString(search.path),
          review: readString(search.review),
          view,
        },
      },
      closable: true,
    }
  }

  if (input.pathname.startsWith('/workspaces/') && workspaceId) {
    return {
      id: workspaceSurfaceId(workspaceId),
      kind: 'workspace',
      title: 'Workspace',
      route: { to: '/workspaces/$workspaceId', params: { workspaceId } },
      closable: true,
    }
  }

  const boardId = readString(params.boardId)
  if (input.pathname.startsWith('/kanban/') && boardId) {
    return {
      id: kanbanSurfaceId(boardId),
      kind: 'kanban',
      title: getI18n().t('chrome:surface.kanban'),
      route: {
        to: '/kanban/$boardId',
        params: { boardId },
        search: {
          issue: readString(search.issue),
          milestoneId: readString(search.milestoneId),
        },
      },
      closable: true,
    }
  }

  const routeSegment = readString(params.routeSegment)
  const localId = readString(params.localId)
  if (input.pathname === '/plugins' || input.pathname === '/plugins/') {
    return {
      id: 'plugin-center',
      kind: 'plugin-center',
      title: getI18n().t('settings:plugins.center.title'),
      route: { to: '/plugins' },
      closable: true,
    }
  }
  if (input.pathname.startsWith('/plugins/') && routeSegment && localId) {
    return {
      id: pluginSurfaceId(routeSegment, localId),
      kind: 'plugin',
      title: 'Plugin',
      route: { to: '/plugins/$routeSegment/$localId', params: { routeSegment, localId } },
      closable: true,
    }
  }

  if (input.pathname === '/awaits') {
    return {
      id: 'awaits',
      kind: 'awaits',
      title: 'Awaits',
      route: { to: '/awaits' },
      closable: true,
    }
  }

  if (input.pathname === '/automation') {
    return {
      id: 'automation',
      kind: 'automation',
      title: 'Automations',
      route: { to: '/automation' },
      closable: true,
    }
  }

  if (input.pathname === '/usage') {
    return {
      id: 'usage',
      kind: 'usage',
      title: getI18n().t('chrome:surface.usage'),
      route: { to: '/usage' },
      closable: true,
    }
  }

  const section = readString(params.section) ?? 'appearance'
  if (input.pathname.startsWith('/settings/')) {
    return {
      id: 'settings',
      kind: 'settings',
      title: 'Settings',
      route: { to: '/settings/$section', params: { section } },
      closable: true,
    }
  }

  if (input.pathname === '/onboarding') {
    return {
      id: 'onboarding',
      kind: 'onboarding',
      title: 'Onboarding',
      route: { to: '/onboarding' },
      closable: true,
    }
  }

  if (input.pathname === '/devtool') {
    return {
      id: 'devtool',
      kind: 'devtool',
      title: 'Devtool',
      route: { to: '/devtool' },
      closable: true,
    }
  }

  return null
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
