import type { UIMessage } from 'ai'
import { clamp } from 'es-toolkit'
import type { Ref } from 'react'
import { useCallback, useImperativeHandle, useReducer, useRef } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { clampRatio } from '~/lib/number-format'
import { chatSelectors, useChatStore } from '~/store/chat'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMinimapProps {
  sessionId: string | null
  messageIds: string[]
  scrollHeight: number
  viewportHeight: number
  onScrollToIndex: (index: number) => void
  onScrollTo: (offset: number) => void
  ref?: Ref<ChatMinimapHandle>
}

export interface ChatMinimapHandle {
  setActiveMessageIndex: (index: number) => void
}

interface ChatMinimapUiState {
  hoverIdx: number | null
  isDragging: boolean
}

type ChatMinimapUiAction
  = { type: 'pointer-start', hoverIdx: number }
    | { type: 'pointer-move', hoverIdx: number }
    | { type: 'pointer-end' }
    | { type: 'pointer-leave' }

const initialChatMinimapUiState: ChatMinimapUiState = {
  hoverIdx: null,
  isDragging: false,
}

function chatMinimapUiReducer(state: ChatMinimapUiState, action: ChatMinimapUiAction): ChatMinimapUiState {
  switch (action.type) {
    case 'pointer-start':
      return {
        hoverIdx: action.hoverIdx,
        isDragging: true,
      }
    case 'pointer-move':
      return {
        ...state,
        hoverIdx: action.hoverIdx,
      }
    case 'pointer-end':
      return {
        ...state,
        isDragging: false,
      }
    case 'pointer-leave':
      return state.isDragging
        ? state
        : {
            ...state,
            hoverIdx: null,
          }
    default:
      return state
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractText(msg: UIMessage): string {
  const texts: string[] = []
  for (const part of msg.parts) {
    if (part.type === 'text') {
      texts.push((part as { text: string }).text)
    }
  }
  return texts.join('\n').trim() || (msg.role === 'user' ? '用户消息' : '助手回复')
}

interface ChatMinimapAnchor {
  messageIndex: number
  preview: string
}

function readAnchorData(message: UIMessage | undefined, messageIndex: number): ChatMinimapAnchor | null {
  if (!message || message.role !== 'user') {
    return null
  }
  const text = extractText(message)
  return {
    messageIndex,
    preview: text.length > 120 ? `${text.slice(0, 120)}…` : text,
  }
}

const EMPTY_MINIMAP_ANCHORS: ChatMinimapAnchor[] = []

type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>

function readMinimapAnchors(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageIds: string[],
): ChatMinimapAnchor[] {
  if (messageIds.length === 0) {
    return EMPTY_MINIMAP_ANCHORS
  }

  const messages = chatSelectors.messages(sessionId)(state)
  if (messages.length === 0) {
    return EMPTY_MINIMAP_ANCHORS
  }

  if (messages.length === messageIds.length) {
    let sameOrder = true
    for (let index = 0; index < messages.length; index++) {
      if (messages[index].id !== messageIds[index]) {
        sameOrder = false
        break
      }
    }
    if (sameOrder) {
      return messages.flatMap((message, index) => {
        const anchor = readAnchorData(message, index)
        return anchor ? [anchor] : []
      })
    }
  }

  const messageById = new Map(messages.map(message => [message.id, message]))
  return messageIds.flatMap((messageId, index) => {
    const anchor = readAnchorData(messageById.get(messageId), index)
    return anchor ? [anchor] : []
  })
}

function areMinimapAnchorsEqual(
  left: ChatMinimapAnchor[],
  right: ChatMinimapAnchor[],
): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index++) {
    if (left[index].messageIndex !== right[index].messageIndex || left[index].preview !== right[index].preview) {
      return false
    }
  }
  return true
}

// ── Component ─────────────────────────────────────────────────────────────────

function ChatMinimapInner({
  sessionId,
  messageIds,
  scrollHeight,
  viewportHeight,
  onScrollToIndex,
  onScrollTo,
  ref,
}: ChatMinimapProps) {
  const containerRef = useRef<HTMLButtonElement>(null)
  const anchorNodesRef = useRef<Array<HTMLSpanElement | null>>([])
  const activeAnchorRef = useRef(0)
  const activeAnchorValueRef = useRef<number | null>(null)
  const [uiState, dispatch] = useReducer(chatMinimapUiReducer, initialChatMinimapUiState)
  const anchors = useChatStore(
    state => readMinimapAnchors(state, sessionId ?? '', messageIds),
    areMinimapAnchorsEqual,
  )

  const scrollable = Math.max(scrollHeight - viewportHeight, 1)
  const anchorCount = anchors.length

  const setActiveMessageIndex = useCallback((messageIndex: number) => {
    if (anchorCount === 0) {
      activeAnchorRef.current = 0
      activeAnchorValueRef.current = null
      return
    }

    let activeAnchor = 0
    for (let index = 0; index < anchorCount; index++) {
      if (anchors[index].messageIndex > messageIndex) {
        break
      }
      activeAnchor = index
    }

    if (activeAnchorValueRef.current === activeAnchor) {
      return
    }

    activeAnchorRef.current = activeAnchor
    activeAnchorValueRef.current = activeAnchor

    for (let index = 0; index < anchorCount; index++) {
      const bar = anchorNodesRef.current[index]
      if (!bar) {
        continue
      }
      bar.dataset.active = index === activeAnchor ? 'true' : 'false'
    }
  }, [anchorCount, anchors])

  const setAnchorNode = (index: number, node: HTMLSpanElement | null) => {
    anchorNodesRef.current[index] = node
  }

  useImperativeHandle(ref, () => ({ setActiveMessageIndex }), [setActiveMessageIndex])

  // Map mouse Y to user-message anchor index.
  const yToIndex = (y: number, height: number) => {
      if (anchorCount === 0 || height === 0) {
        return 0
      }
      const ratio = clampRatio(y / height)
      return Math.min(Math.floor(ratio * anchorCount), anchorCount - 1)
    }

  // Map mouse Y → scroll offset
  const yToScroll = (y: number, height: number) => {
      const ratio = clampRatio(y / height)
      return ratio * scrollable
    }

  const handlePointerDown = (e: React.PointerEvent) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const y = e.clientY - rect.top
        dispatch({
          type: 'pointer-start',
          hoverIdx: yToIndex(y, rect.height),
        })
      }
    }

  const handlePointerMove = (e: React.PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      const y = clamp(e.clientY - rect.top, 0, rect.height)
      dispatch({
        type: 'pointer-move',
        hoverIdx: yToIndex(y, rect.height),
      })
      if (uiState.isDragging) {
        onScrollTo(yToScroll(y, rect.height))
      }
    }

  const handlePointerUp = (e: React.PointerEvent) => {
      dispatch({ type: 'pointer-end' })
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

  const handlePointerLeave = () => {
    dispatch({ type: 'pointer-leave' })
  }

  const scrollToEventMessage = (clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }

      const y = clamp(clientY - rect.top, 0, rect.height)
      const anchor = anchors[yToIndex(y, rect.height)]
      if (anchor) {
        onScrollToIndex(anchor.messageIndex)
      }
    }

  const scrollToKeyboardMessage = () => {
    const anchor = anchors[uiState.hoverIdx ?? activeAnchorRef.current]
    if (anchor) {
      onScrollToIndex(anchor.messageIndex)
    }
  }

  if (anchorCount === 0) {
    return null
  }

  return (
    <div
      className="pointer-events-none absolute right-1 top-0 bottom-0 z-10 flex items-center justify-center"
    >
      <Button
        type="button"
        variant="ghost"
        ref={containerRef}
        aria-label="Chat minimap"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            scrollToKeyboardMessage()
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={e => scrollToEventMessage(e.clientY)}
        className="pointer-events-auto relative flex h-auto cursor-pointer flex-col items-center justify-center gap-3 rounded-full bg-transparent p-0 hover:bg-transparent focus-visible:ring-1 focus-visible:ring-ring"
      >
        {anchors.map((anchor, i) => {
          return (
            <ChatMinimapBar
              key={messageIds[anchor.messageIndex]}
              index={i}
              anchor={anchor}
              hovered={uiState.hoverIdx === i}
              setAnchorNode={setAnchorNode}
            />
          )
        })}
      </Button>
    </div>
  )
}

function ChatMinimapBar({
  index,
  anchor,
  hovered,
  setAnchorNode,
}: {
  index: number
  anchor: ChatMinimapAnchor
  hovered: boolean
  setAnchorNode: (index: number, node: HTMLSpanElement | null) => void
}) {
  return (
    <span
      className="group/minimap-bar relative block"
    >
      <span
        ref={(node) => {
          setAnchorNode(index, node)
        }}
        data-active="false"
        className={cn(
          'block h-1 w-7 rounded-full bg-foreground/40 transition-[background-color,opacity,scale] duration-150',
          'data-[active=true]:bg-foreground/95 data-[active=true]:opacity-100',
          'opacity-55',
          hovered && 'scale-x-110 bg-foreground/80 opacity-100',
        )}
      />
      <ChatMinimapHoverPreview
        anchor={anchor}
        index={index}
        visible={hovered}
      />
    </span>
  )
}

function ChatMinimapHoverPreview({
  anchor,
  index,
  visible,
}: {
  anchor: ChatMinimapAnchor
  index: number
  visible: boolean
}) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute right-full top-1/2 z-20 mr-2 w-56 -translate-y-1/2 rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-md',
        'opacity-0 group-hover/minimap-bar:opacity-100',
        visible && 'opacity-100',
      )}
    >
      <span className="mb-1 flex items-center gap-1.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            'bg-foreground/50',
          )}
        />
        <span className="text-[10px] font-medium text-muted-foreground">
          {`User · #${index + 1}`}
        </span>
      </span>
      <span className="line-clamp-4 text-left text-xs/relaxed text-foreground">
        {anchor.preview}
      </span>
    </span>
  )
}

export { ChatMinimapInner as ChatMinimap }
