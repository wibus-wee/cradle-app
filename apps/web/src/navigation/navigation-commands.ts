import { closeFocusedChatSplitPane } from '~/features/chat/split-workspace/chat-split-close'
import { getI18n } from '~/i18n/instance'
import { router } from '~/router'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import { readActiveSurface, readActiveSurfaceId } from './active-surface'
import {
  clearRouteSurfaceSyncSuppressionForSurface,
  suppressRouteSurfaceSync,
} from './route-surface-sync-key'
import type { AppSurface, SurfaceDraft } from './surface-identity'
import {
  chatSurfaceId,
  createHomeSurfaceDraft,
  diffSurfaceId,
  HOME_SURFACE,
  kanbanSurfaceId,
  pluginSurfaceId,
  pullRequestsSurfaceId,
  sortSurfaces,
  workspaceDiffsSurfaceId,
  workspaceSurfaceId,
  workSurfaceId,
} from './surface-identity'
import { readSurface, useSurfaceStore } from './surface-store'

type RouterNavigateOptions = Parameters<typeof router.navigate>[0]

function toRouterNavigateOptions(surface: Pick<AppSurface, 'route'> | SurfaceDraft, replace = false): RouterNavigateOptions {
  return {
    ...surface.route,
    replace,
  } as RouterNavigateOptions
}

export function navigateToSurface(surface: AppSurface, options: { replace?: boolean } = {}): void {
  useSurfaceStore.getState().syncSurface(surface)
  void router.navigate(toRouterNavigateOptions(surface, options.replace))
}

function openSurface(surface: SurfaceDraft, options: { replace?: boolean } = {}): void {
  clearRouteSurfaceSyncSuppressionForSurface(surface.id)
  if (options.replace) {
    useSurfaceStore.getState().replaceSurface(readActiveSurfaceId(), surface)
  }
  else {
    useSurfaceStore.getState().syncSurface(surface)
  }
  void router.navigate(toRouterNavigateOptions(surface, options.replace))
}

export function openHome(options: { replace?: boolean } = {}): void {
  openSurface(createHomeSurfaceDraft(), options)
}

export function openNewChat(options: {
  replace?: boolean
  issueId?: string
  workspaceId?: string
  sessionGroupId?: string
} = {}): void {
  const search: Record<string, string> = {}
  if (options.issueId) {
    search.issueId = options.issueId
  }
  if (options.workspaceId) {
    search.workspaceId = options.workspaceId
  }
  if (options.sessionGroupId) {
    search.sessionGroupId = options.sessionGroupId
  }
  openSurface({
    id: 'new-chat',
    kind: 'new-chat',
    title: getI18n().t('search:command.newChat.label'),
    route: Object.keys(search).length > 0
      ? { to: '/chat/new', search }
      : { to: '/chat/new' },
    closable: true,
  }, options)
}

export function openNewWork(options: {
  replace?: boolean
  workspaceId?: string
  issueId?: string
} = {}): void {
  openSurface({
    id: 'new-work',
    kind: 'new-work',
    title: getI18n().t('work:surface.new'),
    route: {
      to: '/work/new',
      search: {
        workspaceId: options.workspaceId,
        issueId: options.issueId,
      },
    },
    closable: true,
  }, options)
}

export function openWork(workId: string, options: { replace?: boolean } = {}): void {
  openSurface({
    id: workSurfaceId(workId),
    kind: 'work',
    title: getI18n().t('work:surface.work'),
    route: { to: '/work/$workId', params: { workId } },
    closable: true,
  }, options)
}

export function openPullRequests(options: { replace?: boolean, workId?: string } = {}): void {
  openSurface({
    id: pullRequestsSurfaceId(),
    kind: 'pull-requests',
    title: getI18n().t('pull-requests:surface.title'),
    route: {
      to: '/pull-requests',
      search: { workId: options.workId },
    },
    closable: true,
  }, options)
}

export function openChatSession(sessionId: string, options: { replace?: boolean } = {}): void {
  openSurface({
    id: chatSurfaceId(sessionId),
    kind: 'chat',
    title: 'Chat',
    route: { to: '/chat/$sessionId', params: { sessionId } },
    closable: true,
  }, options)
}

export function openDiff(options: { replace?: boolean } = {}): void {
  openSurface({
    id: diffSurfaceId(),
    kind: 'diff',
    title: 'Cradle Diffs',
    route: { to: '/diff' },
    closable: true,
  }, options)
}

export function openWorkspaceDetail(workspaceId: string, options: { replace?: boolean } = {}): void {
  openSurface({
    id: workspaceSurfaceId(workspaceId),
    kind: 'workspace',
    title: 'Workspace',
    route: { to: '/workspaces/$workspaceId', params: { workspaceId } },
    closable: true,
  }, options)
}

export function openWorkspaceDiffs(input: {
  workspaceId: string
  repositoryPath?: string
  path?: string
  reviewId?: string
}, options: { replace?: boolean } = {}): void {
  openSurface({
    id: workspaceDiffsSurfaceId(input.workspaceId),
    kind: 'workspace-diffs',
    title: 'Cradle Diffs',
    route: {
      to: '/workspaces/$workspaceId/diffs',
      params: { workspaceId: input.workspaceId },
      search: {
        repo: input.repositoryPath && input.repositoryPath !== '.' ? input.repositoryPath : undefined,
        path: input.path,
        review: input.reviewId,
      },
    },
    closable: true,
  }, options)
}

export function openKanbanBoard(input: {
  boardId: string
  issueId?: string
  milestoneId?: string
}, options: { replace?: boolean } = {}): void {
  openSurface({
    id: kanbanSurfaceId(input.boardId),
    kind: 'kanban',
    title: getI18n().t('search:command.kanban.label'),
    route: {
      to: '/kanban/$boardId',
      params: { boardId: input.boardId },
      search: {
        issue: input.issueId,
        milestoneId: input.milestoneId,
      },
    },
    closable: true,
  }, options)
}

export function openPluginPanel(input: {
  routeSegment: string
  localId: string
}, options: { replace?: boolean } = {}): void {
  openSurface({
    id: pluginSurfaceId(input.routeSegment, input.localId),
    kind: 'plugin',
    title: 'Plugin',
    route: {
      to: '/plugins/$routeSegment/$localId',
      params: {
        routeSegment: input.routeSegment,
        localId: input.localId,
      },
    },
    closable: true,
  }, options)
}

export function openSettingsSection(section: string, options: { replace?: boolean } = {}): void {
  const activeSurface = readActiveSurface()
  const settingsStore = useSettingsOverlayStore.getState()

  if (activeSurface?.kind !== 'settings') {
    const returnSurfaceId = activeSurface ? readSurface(activeSurface.id)?.id : null
    settingsStore.setSettingsReturnSurfaceId(returnSurfaceId ?? HOME_SURFACE.id)
  }
  settingsStore.setSettingsSection(section)

  void router.navigate({
    to: '/settings/$section',
    params: { section },
    replace: options.replace,
  })
}

export function openAwaits(options: { replace?: boolean } = {}): void {
  openSurface({
    id: 'awaits',
    kind: 'awaits',
    title: 'Awaits',
    route: { to: '/awaits' },
    closable: true,
  }, options)
}

export function openPluginCenter(options: { replace?: boolean } = {}): void {
  openSurface({
    id: 'plugin-center',
    kind: 'plugin-center',
    title: getI18n().t('settings:plugins.center.title'),
    route: { to: '/plugins' },
    closable: true,
  }, options)
}

export function openAutomation(options: { replace?: boolean } = {}): void {
  openSurface({
    id: 'automation',
    kind: 'automation',
    title: 'Automations',
    route: { to: '/automation' },
    closable: true,
  }, options)
}

export function openUsage(options: { replace?: boolean } = {}): void {
  openSurface({
    id: 'usage',
    kind: 'usage',
    title: getI18n().t('search:command.usage.label'),
    route: { to: '/usage' },
    closable: true,
  }, options)
}

function readFallbackSurface(
  previousSurfaces: readonly AppSurface[],
  nextSurfaces: readonly AppSurface[],
  closedSurfaceId: string,
): AppSurface {
  const orderedPrevious = sortSurfaces(previousSurfaces)
  const orderedNext = sortSurfaces(nextSurfaces)
  const closedIndex = orderedPrevious.findIndex(surface => surface.id === closedSurfaceId)
  return orderedNext[Math.min(Math.max(closedIndex, 0), orderedNext.length - 1)]
    ?? orderedNext.at(-1)
    ?? HOME_SURFACE
}

export function closeSurfaceById(surfaceId: string): void {
  if (surfaceId === 'settings' && readActiveSurface()?.kind === 'settings') {
    const settingsStore = useSettingsOverlayStore.getState()
    const returnSurface = readSurface(settingsStore.settingsReturnSurfaceId ?? '') ?? HOME_SURFACE
    settingsStore.setSettingsReturnSurfaceId(null)
    navigateToSurface(returnSurface, { replace: true })
    return
  }

  const previousSurfaces = useSurfaceStore.getState().surfaces
  const activeSurfaceId = readActiveSurfaceId()
  if (activeSurfaceId === surfaceId) {
    suppressRouteSurfaceSync(surfaceId)
  }

  useSurfaceStore.getState().closeSurface(surfaceId)

  if (activeSurfaceId !== surfaceId) {
    return
  }

  const nextSurface = readFallbackSurface(
    previousSurfaces,
    useSurfaceStore.getState().surfaces,
    surfaceId,
  )
  navigateToSurface(nextSurface, { replace: true })
}

export function closeActiveSurface(): void {
  const activeSurfaceId = readActiveSurfaceId()
  if (!activeSurfaceId) {
    return
  }
  // VSCode-style Cmd+W: close the focused split pane first, only closing the
  // whole tab once the surface is back down to its single primary pane.
  if (closeFocusedChatSplitPane(activeSurfaceId)) {
    return
  }
  closeSurfaceById(activeSurfaceId)
}

export function activateSurface(surfaceId: string): void {
  const surface = readSurface(surfaceId)
  if (!surface) {
    return
  }
  navigateToSurface(surface)
}

export function activateAdjacentSurface(direction: 1 | -1): void {
  const state = useSurfaceStore.getState()
  const surfaces = [...state.surfaces].sort((left, right) => left.order - right.order)
  const activeSurfaceId = readActiveSurface()?.id ?? HOME_SURFACE.id
  if (surfaces.length <= 1) {
    return
  }

  const currentIndex = Math.max(0, surfaces.findIndex(surface => surface.id === activeSurfaceId))
  const nextIndex = (currentIndex + direction + surfaces.length) % surfaces.length
  activateSurface(surfaces[nextIndex]!.id)
}
