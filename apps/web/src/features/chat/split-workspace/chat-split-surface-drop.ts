import type { DockviewGroupPanel } from 'dockview-react'

import { findChatSplitGroupAtPoint } from './chat-split-dockview-registry'
import type { FlatSplitDirection } from './chat-split-drop-quadrant'
import { directionFromDropPoint } from './chat-split-drop-quadrant'
import type { ChatSplitHoverBounds } from './chat-split-hover'
import { clearChatSplitHover, setChatSplitHover } from './chat-split-hover'
import { splitSession } from './chat-split-session'

const CHAT_SURFACE_DRAG_EVENT = 'cradle:chat-surface-drag'

export interface ChatSurfaceDragDetail {
  clientX: number | null
  clientY: number | null
  sessionId: string | null
}

export interface ResolvedChatSplitTarget {
  surfaceId: string
  primarySessionId: string
  direction: FlatSplitDirection
  bounds: ChatSplitHoverBounds
  referenceGroup?: DockviewGroupPanel
}

/**
 * Thin pointer stream for top Chat Tab drags (not HTML5 DataTransfer).
 * Not a second split system — only feeds hit-testing + shared hover state
 * so Tab drops can call the same `splitSession` path as the sidebar.
 */
export function publishChatSurfaceDrag(detail: ChatSurfaceDragDetail): void {
  window.dispatchEvent(new CustomEvent<ChatSurfaceDragDetail>(CHAT_SURFACE_DRAG_EVENT, { detail }))
}

export function subscribeChatSurfaceDrag(
  listener: (detail: ChatSurfaceDragDetail) => void,
): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<ChatSurfaceDragDetail>).detail)
  }
  window.addEventListener(CHAT_SURFACE_DRAG_EVENT, handleEvent)
  return () => window.removeEventListener(CHAT_SURFACE_DRAG_EVENT, handleEvent)
}

function boundsFromRect(rect: DOMRectReadOnly): ChatSplitHoverBounds {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * Walk the element stack so a floating drag ghost (`pointer-events` still
 * hit-testing in some hosts) cannot steal the chat surface under the cursor.
 */
function chatSplitElementFromPoint(clientX: number, clientY: number): HTMLElement | null {
  const stack = document.elementsFromPoint(clientX, clientY)
  for (const node of stack) {
    if (!(node instanceof Element)) {
      continue
    }
    const target = node.closest<HTMLElement>('[data-chat-split-drop-surface-id]')
    if (target) {
      return target
    }
  }
  return null
}

/**
 * Resolve surface + direction + (when already split) the pane group under
 * the pointer. Shared by Tab hover and Tab drop so they cannot disagree.
 */
export function resolveChatSplitTargetAtPoint(input: {
  clientX: number
  clientY: number
  sessionId: string
}): ResolvedChatSplitTarget | null {
  const target = chatSplitElementFromPoint(input.clientX, input.clientY)
  const surfaceId = target?.dataset.chatSplitDropSurfaceId
  const primarySessionId = target?.dataset.chatSplitPrimarySessionId
  if (!target || !surfaceId || !primarySessionId || primarySessionId === input.sessionId) {
    return null
  }

  const referenceGroup = findChatSplitGroupAtPoint(surfaceId, input.clientX, input.clientY)
  const rect = referenceGroup?.element.getBoundingClientRect() ?? target.getBoundingClientRect()
  const direction = directionFromDropPoint(rect, input)

  return {
    surfaceId,
    primarySessionId,
    direction,
    bounds: boundsFromRect(rect),
    referenceGroup,
  }
}

/**
 * Resolve the chat surface under the pointer and split into it.
 * Used by the top surface-bar when a chat tab is released over content.
 */
export function dropChatSurfaceAtPoint(input: {
  clientX: number
  clientY: number
  sessionId: string
}): boolean {
  clearChatSplitHover()

  const resolved = resolveChatSplitTargetAtPoint(input)
  if (!resolved) {
    return false
  }

  return splitSession(resolved.surfaceId, input.sessionId, resolved.direction, {
    clientX: input.clientX,
    clientY: input.clientY,
    referenceGroup: resolved.referenceGroup,
  })
}

/**
 * Update shared split hover from a Tab pointer sample. Uses the same hit
 * resolution as drop so overlay and commit always match.
 */
export function updateChatSurfaceDragHover(detail: ChatSurfaceDragDetail): void {
  if (
    detail.sessionId === null
    || detail.clientX === null
    || detail.clientY === null
  ) {
    clearChatSplitHover()
    return
  }

  const resolved = resolveChatSplitTargetAtPoint({
    clientX: detail.clientX,
    clientY: detail.clientY,
    sessionId: detail.sessionId,
  })

  if (!resolved) {
    clearChatSplitHover()
    return
  }

  setChatSplitHover({
    surfaceId: resolved.surfaceId,
    direction: resolved.direction,
    bounds: resolved.bounds,
  })
}
