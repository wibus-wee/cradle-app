import { useSyncExternalStore } from 'react'

import type { FlatSplitDirection } from './chat-split-drop-quadrant'

export interface ChatSplitHoverBounds {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Shared hover overlay for chat session split drops. Driven by both:
 * - sidebar HTML5 drag over a flat (unsplit) chat surface
 * - top Chat Tab pointer drag over any chat surface (flat or already split)
 *
 * Multi-pane sidebar HTML5 drops still use Dockview's native edge overlays;
 * this state covers the custom (non-HTML5) Tab path and the flat first-split.
 */
export interface ChatSplitHover {
  surfaceId: string
  direction: FlatSplitDirection
  /**
   * Viewport rect of the drop target (full surface or a single dockview
   * group). When set, the indicator is `position: fixed` to that rect so
   * multi-pane Tab hovers match per-pane sidebar feedback.
   */
  bounds: ChatSplitHoverBounds
}

let hover: ChatSplitHover | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function sameBounds(a: ChatSplitHoverBounds, b: ChatSplitHoverBounds): boolean {
  return a.left === b.left
    && a.top === b.top
    && a.width === b.width
    && a.height === b.height
}

function sameHover(a: ChatSplitHover | null, b: ChatSplitHover | null): boolean {
  if (a === b) {
    return true
  }
  if (!a || !b) {
    return false
  }
  return a.surfaceId === b.surfaceId
    && a.direction === b.direction
    && sameBounds(a.bounds, b.bounds)
}

export function setChatSplitHover(next: ChatSplitHover | null): void {
  if (sameHover(hover, next)) {
    return
  }
  hover = next
  emit()
}

export function clearChatSplitHover(surfaceId?: string): void {
  if (!hover) {
    return
  }
  if (surfaceId && hover.surfaceId !== surfaceId) {
    return
  }
  hover = null
  emit()
}

/** Test/debug read of the current shared hover. */
export function getChatSplitHover(): ChatSplitHover | null {
  return hover
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ChatSplitHover | null {
  return hover
}

/** Full hover payload for this surface, or null. */
export function useChatSplitHover(surfaceId: string): ChatSplitHover | null {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => null)
  return current?.surfaceId === surfaceId ? current : null
}
