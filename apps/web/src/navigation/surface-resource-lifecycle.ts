import { deleteTerminalSessionsShellByPtyId } from '~/api-gen/sdk.gen'
import {
  markComposerDraftSurfaceDiscarded,
  queueServerComposerDraftDelete,
} from '~/features/chat/commands/composer-draft-command'
import { stopTerminalPanelOwners } from '~/features/tui/terminal-panel-cleanup'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useComposerDraftStore } from '~/store/composer-draft'

import type { AppSurface } from './surface-identity'
import { useSurfaceStore } from './surface-store'

type TerminalPanelStopper = (ownerIds: string[]) => void
type BrowserPanelOwnerReleaser = (ownerIds: string[]) => void
type TuiRuntimeDisposer = (sessionIds: string[]) => void
type BrowserPanelOwners = ReturnType<typeof useBrowserPanelStore.getState>['owners']

function readTerminalPanelOwnerId(surface: Pick<AppSurface, 'kind' | 'route'>): string | null {
  if (surface.kind === 'chat' && surface.route.to === '/chat/$sessionId') {
    return `chat:${surface.route.params.sessionId}`
  }

  if (surface.kind === 'workspace' && surface.route.to === '/workspaces/$workspaceId') {
    return `workspace:${surface.route.params.workspaceId}`
  }

  return null
}

export function selectTerminalPanelOwnerIds(surfaces: readonly Pick<AppSurface, 'kind' | 'route'>[]): Set<string> {
  const ownerIds = new Set<string>()

  for (const surface of surfaces) {
    const ownerId = readTerminalPanelOwnerId(surface)
    if (ownerId) {
      ownerIds.add(ownerId)
    }
  }

  return ownerIds
}

export function selectClosedTerminalPanelOwnerIds(
  previousSurfaces: readonly Pick<AppSurface, 'kind' | 'route'>[],
  nextSurfaces: readonly Pick<AppSurface, 'kind' | 'route'>[],
): string[] {
  const previousOwnerIds = selectTerminalPanelOwnerIds(previousSurfaces)
  const nextOwnerIds = selectTerminalPanelOwnerIds(nextSurfaces)

  return Array.from(previousOwnerIds).filter(ownerId => !nextOwnerIds.has(ownerId))
}

export function selectClosedBrowserPanelOwnerIds(
  previousSurfaces: readonly Pick<AppSurface, 'id'>[],
  nextSurfaces: readonly Pick<AppSurface, 'id'>[],
): string[] {
  const nextOwnerIds = new Set(nextSurfaces.map(surface => surface.id))
  return previousSurfaces
    .map(surface => surface.id)
    .filter(ownerId => !nextOwnerIds.has(ownerId))
}

export function selectClosedChatSessionIds(
  previousSurfaces: readonly Pick<AppSurface, 'kind' | 'route'>[],
  nextSurfaces: readonly Pick<AppSurface, 'kind' | 'route'>[],
): string[] {
  const nextSessionIds = new Set(
    nextSurfaces.flatMap(surface => (
      surface.kind === 'chat' && surface.route.to === '/chat/$sessionId'
        ? [surface.route.params.sessionId]
        : []
    )),
  )
  return previousSurfaces.flatMap(surface => (
    surface.kind === 'chat'
    && surface.route.to === '/chat/$sessionId'
    && !nextSessionIds.has(surface.route.params.sessionId)
      ? [surface.route.params.sessionId]
      : []
  ))
}

function disposeTuiRuntimes(sessionIds: string[]): void {
  void import('~/features/tui/tui-runtime-registry').then(({ tuiRuntimeRegistry }) => {
    for (const sessionId of sessionIds) {
      tuiRuntimeRegistry.dispose(sessionId)
    }
  })
}

function releaseBrowserPanelOwners(ownerIds: string[]): void {
  const browserStore = useBrowserPanelStore.getState()
  const browserBridge = window.cradle?.browser

  for (const ownerId of ownerIds) {
    browserStore.releaseOwnerRuntimeState(ownerId)
    void browserBridge?.close({ threadId: ownerId }).catch(() => {})
  }
}

function selectBrowserPanelTuiPtyIds(owners: BrowserPanelOwners): Set<string> {
  const ptyIds = new Set<string>()

  for (const owner of Object.values(owners)) {
    for (const tab of owner?.tabs ?? []) {
      if (tab.kind === 'tui') {
        ptyIds.add(tab.ptyId)
      }
    }
  }

  return ptyIds
}

export function selectClosedBrowserPanelTuiPtyIds(
  previousOwners: BrowserPanelOwners,
  nextOwners: BrowserPanelOwners,
): string[] {
  const previousPtyIds = selectBrowserPanelTuiPtyIds(previousOwners)
  const nextPtyIds = selectBrowserPanelTuiPtyIds(nextOwners)

  return Array.from(previousPtyIds).filter(ptyId => !nextPtyIds.has(ptyId))
}

function stopShellPtyIds(ptyIds: Iterable<string>): void {
  for (const ptyId of ptyIds) {
    void deleteTerminalSessionsShellByPtyId({
      path: { ptyId },
    }).catch(() => {})
  }
}

function cleanupClosedComposerDrafts(
  previousSurfaces: readonly Pick<AppSurface, 'id'>[],
  nextSurfaces: readonly Pick<AppSurface, 'id'>[],
): void {
  const nextIds = new Set(nextSurfaces.map(surface => surface.id))
  const draftStore = useComposerDraftStore.getState()
  for (const surface of previousSurfaces) {
    if (!nextIds.has(surface.id)) {
      markComposerDraftSurfaceDiscarded(surface.id)
      draftStore.deleteDraft(surface.id)
      queueServerComposerDraftDelete(surface.id)
    }
  }
}

export function releaseSurfaceResources(
  previousSurfaces: readonly AppSurface[],
  nextSurfaces: readonly AppSurface[],
  stopOwners: TerminalPanelStopper = stopTerminalPanelOwners,
  releaseBrowserOwners: BrowserPanelOwnerReleaser = releaseBrowserPanelOwners,
  disposeTuiSessions: TuiRuntimeDisposer = disposeTuiRuntimes,
): void {
  const closedTerminalOwnerIds = selectClosedTerminalPanelOwnerIds(previousSurfaces, nextSurfaces)
  if (closedTerminalOwnerIds.length > 0) {
    stopOwners(closedTerminalOwnerIds)
  }

  const closedBrowserOwnerIds = selectClosedBrowserPanelOwnerIds(previousSurfaces, nextSurfaces)
  if (closedBrowserOwnerIds.length > 0) {
    releaseBrowserOwners(closedBrowserOwnerIds)
  }

  const closedChatSessionIds = selectClosedChatSessionIds(previousSurfaces, nextSurfaces)
  if (closedChatSessionIds.length > 0) {
    disposeTuiSessions(closedChatSessionIds)
  }

  cleanupClosedComposerDrafts(previousSurfaces, nextSurfaces)
}

export function installSurfaceResourceLifecycle(): () => void {
  const unsubscribeSurfaces = useSurfaceStore.subscribe((state, previousState) => {
    if (state.surfaces === previousState.surfaces) {
      return
    }
    releaseSurfaceResources(previousState.surfaces, state.surfaces)
  })
  const unsubscribeBrowserPanelTabs = useBrowserPanelStore.subscribe((state, previousState) => {
    if (state.owners === previousState.owners) {
      return
    }
    stopShellPtyIds(selectClosedBrowserPanelTuiPtyIds(previousState.owners, state.owners))
  })

  return () => {
    unsubscribeSurfaces()
    unsubscribeBrowserPanelTabs()
  }
}
