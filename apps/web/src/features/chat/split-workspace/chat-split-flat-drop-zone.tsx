import './dockview-theme-cradle'

import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useRef } from 'react'

import { isSessionDragEvent, readDraggedSessionId } from '~/features/workspace/session-drag-data'

import type { FlatSplitDirection } from './chat-split-drop-quadrant'
import { directionFromDropPoint } from './chat-split-drop-quadrant'
import type { ChatSplitHover, ChatSplitHoverBounds } from './chat-split-hover'
import { clearChatSplitHover, setChatSplitHover } from './chat-split-hover'
import { splitSession } from './chat-split-session'

/**
 * Geometry for the sliding drop fill — same half-pane quadrants dockview uses,
 * expressed as percentages so CSS can animate top/left/width/height between
 * directions instead of swapping discrete class names.
 */
function indicatorStyleForDirection(direction: FlatSplitDirection): CSSProperties {
  switch (direction) {
    case 'left':
      return { top: 0, left: 0, width: '50%', height: '100%' }
    case 'right':
      return { top: 0, left: '50%', width: '50%', height: '100%' }
    case 'above':
      return { top: 0, left: 0, width: '100%', height: '50%' }
    case 'below':
      return { top: '50%', left: 0, width: '100%', height: '50%' }
  }
}

function boundsFromRect(rect: DOMRectReadOnly): ChatSplitHoverBounds {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

export function ChatSplitDropIndicator({
  direction,
  bounds,
}: {
  direction: FlatSplitDirection
  bounds?: ChatSplitHoverBounds | null
}) {
  // Keep a single fill node so top/left/width/height can CSS-transition when
  // the pointer crosses quadrants — same idea as dockview's selection overlay.
  const fill = (
    <div
      aria-hidden="true"
      className="chat-split-drop-indicator"
      style={indicatorStyleForDirection(direction)}
    />
  )

  if (bounds) {
    return (
      <div
        aria-hidden="true"
        className="chat-split-drop-indicator-host dockview-theme-cradle"
        style={{
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        }}
      >
        {fill}
      </div>
    )
  }

  return (
    <div aria-hidden="true" className="chat-split-drop-indicator-host-local dockview-theme-cradle">
      {fill}
    </div>
  )
}

export function ChatSplitDropIndicatorFromHover({ hover }: { hover: ChatSplitHover }) {
  return <ChatSplitDropIndicator direction={hover.direction} bounds={hover.bounds} />
}

/**
 * Wraps the flat (non-split) chat view so a session dragged in from the
 * sidebar can create the very first split pane. Once a workspace has two or
 * more panes, `dockview` itself takes over drag-and-drop handling — this
 * component only exists to bootstrap that transition.
 *
 * Hover feedback goes through the shared `chat-split-hover` state so the
 * parent can render one overlay for both sidebar and top-tab drags.
 */
export function ChatSplitFlatDropZone({
  surfaceId,
  primarySessionId,
  children,
}: {
  surfaceId: string
  primarySessionId: string
  children: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!isSessionDragEvent(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const bounds = containerRef.current?.getBoundingClientRect()
    if (!bounds) {
      return
    }
    setChatSplitHover({
      surfaceId,
      direction: directionFromDropPoint(bounds, event),
      bounds: boundsFromRect(bounds),
    })
  }, [surfaceId])

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (containerRef.current && nextTarget instanceof Node && containerRef.current.contains(nextTarget)) {
      return
    }
    clearChatSplitHover(surfaceId)
  }, [surfaceId])

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!isSessionDragEvent(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    const sessionId = readDraggedSessionId(event.dataTransfer)
    const bounds = containerRef.current?.getBoundingClientRect()
    clearChatSplitHover(surfaceId)

    if (!sessionId || sessionId === primarySessionId) {
      return
    }
    const direction = bounds ? directionFromDropPoint(bounds, event) : 'right'
    splitSession(surfaceId, sessionId, direction)
  }, [primarySessionId, surfaceId])

  return (
    <div
      ref={containerRef}
      data-chat-split-drop-surface-id={surfaceId}
      data-chat-split-primary-session-id={primarySessionId}
      className="dockview-theme-cradle relative h-full w-full min-h-0 min-w-0"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  )
}
