import type { DockviewApi, DockviewGroupPanel } from 'dockview-react'

import type { ChatSplitDirection } from './chat-split-workspace-store'

/**
 * Transient (non-persisted) registry of live `DockviewApi` instances keyed by
 * surface id. Lets code outside the `dockview` component tree — e.g. the
 * global Cmd+W handler and top-tab drop path — command a specific split
 * workspace without piping the api instance through props.
 */
interface ChatSplitDockviewRegistration {
  api: DockviewApi
  addSession: (
    sessionId: string,
    direction: ChatSplitDirection,
    referenceGroup?: DockviewGroupPanel,
  ) => boolean
}

const registry = new Map<string, ChatSplitDockviewRegistration>()

export function registerChatSplitDockviewApi(
  surfaceId: string,
  registration: ChatSplitDockviewRegistration,
): () => void {
  registry.set(surfaceId, registration)
  return () => {
    if (registry.get(surfaceId) === registration) {
      registry.delete(surfaceId)
    }
  }
}

export function getChatSplitDockviewApi(surfaceId: string): DockviewApi | undefined {
  return registry.get(surfaceId)?.api
}

export function findChatSplitGroupAtPoint(
  surfaceId: string,
  clientX: number,
  clientY: number,
): DockviewGroupPanel | undefined {
  const api = registry.get(surfaceId)?.api
  if (!api) {
    return undefined
  }

  for (const group of api.groups) {
    const rect = group.element.getBoundingClientRect()
    if (
      clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
    ) {
      return group
    }
  }

  return api.activeGroup ?? api.groups[0]
}

export function addChatSplitDockviewSession(
  surfaceId: string,
  sessionId: string,
  direction: ChatSplitDirection,
  referenceGroup?: DockviewGroupPanel,
): boolean {
  return registry.get(surfaceId)?.addSession(sessionId, direction, referenceGroup) ?? false
}
