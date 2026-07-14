import type { DockviewGroupPanel } from 'dockview-react'

import { addChatSplitDockviewSession, findChatSplitGroupAtPoint } from './chat-split-dockview-registry'
import type { ChatSplitDirection } from './chat-split-workspace-store'
import { useChatSplitWorkspaceStore } from './chat-split-workspace-store'

export interface SplitSessionOptions {
  /** When set and Dockview is live, place relative to the group under this point. */
  clientX?: number
  clientY?: number
  /** Explicit group reference when the caller already resolved one. */
  referenceGroup?: DockviewGroupPanel
}

/**
 * Single entry point for "open this session as a directional split pane
 * inside the given chat surface".
 *
 * - If Dockview is already mounted for the surface, mutates the live layout.
 * - Otherwise records the pane (+ pending first-split direction) so the
 *   workspace mounts Dockview and places it correctly.
 *
 * Both the sidebar HTML5 drop path and the top Chat Tab drop path call this
 * after they resolve `surfaceId` + `direction` from the pointer.
 */
export function splitSession(
  surfaceId: string,
  sessionId: string,
  direction: ChatSplitDirection,
  options?: SplitSessionOptions,
): boolean {
  const referenceGroup = options?.referenceGroup
    ?? (
      options?.clientX !== undefined && options?.clientY !== undefined
        ? findChatSplitGroupAtPoint(surfaceId, options.clientX, options.clientY)
        : undefined
    )

  if (addChatSplitDockviewSession(surfaceId, sessionId, direction, referenceGroup)) {
    return true
  }
  return useChatSplitWorkspaceStore.getState().addPane(surfaceId, sessionId, direction)
}
