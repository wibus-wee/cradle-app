// Chat-owned scroll controller for virtualized session transcripts.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { VirtualizerHandle } from 'virtua'
import { useShallow } from 'zustand/react/shallow'

import { chatSelectors, useChatStore } from '~/store/chat'

import { clearChatAttentionSnapshot, updateChatAttentionSnapshot } from '../context/chat-context'
import type { ChatMinimapHandle } from './chat-minimap'

export interface ChatScrollMetrics {
  offset: number
  scrollHeight: number
  viewportHeight: number
}

export interface ChatScrollRuntime {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  viewportRef: React.RefObject<HTMLDivElement | null>
  composerOverlayRef: React.RefObject<HTMLDivElement | null>
  virtualizerRef: React.RefObject<VirtualizerHandle | null>
  minimapRef: React.RefObject<ChatMinimapHandle | null>
  keepMountedIndices?: number[]
  metrics: ChatScrollMetrics
  handleVirtualScroll: (offset: number) => void
  scrollToMessageIndex: (index: number) => void
  scrollToOffset: (offset: number) => void
  handleComposerFocusChange: (focused: boolean) => void
}

interface UseChatScrollRuntimeOptions {
  active: boolean
  sessionId: string | null
  messageIds: string[]
  status: string
}

const EMPTY_SCROLL_METRICS: ChatScrollMetrics = { offset: 0, scrollHeight: 0, viewportHeight: 0 }
const EMPTY_STREAMING_MESSAGE_IDS = new Set<string>()
const BOTTOM_PROXIMITY_PX = 8

function clampScrollOffset(offset: number, scrollHeight: number, viewportHeight: number): number {
  const maxScroll = Math.max(scrollHeight - viewportHeight, 0)
  return Math.min(Math.max(offset, 0), maxScroll)
}

function normalizeScrollMetrics(metrics: ChatScrollMetrics): ChatScrollMetrics {
  return {
    ...metrics,
    offset: clampScrollOffset(metrics.offset, metrics.scrollHeight, metrics.viewportHeight),
  }
}

function readScrollRatio(metrics: ChatScrollMetrics): number {
  const scrollable = Math.max(metrics.scrollHeight - metrics.viewportHeight, 0)
  const offset = clampScrollOffset(metrics.offset, metrics.scrollHeight, metrics.viewportHeight)
  return scrollable > 0 ? offset / scrollable : 1
}

function readIsAtBottom(metrics: ChatScrollMetrics): boolean {
  const maxScroll = Math.max(metrics.scrollHeight - metrics.viewportHeight, 0)
  const offset = clampScrollOffset(metrics.offset, metrics.scrollHeight, metrics.viewportHeight)
  return offset >= maxScroll - BOTTOM_PROXIMITY_PX
}

export function useChatScrollRuntime({
  active,
  sessionId,
  messageIds,
  status,
}: UseChatScrollRuntimeOptions): ChatScrollRuntime {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const composerOverlayRef = useRef<HTMLDivElement>(null)
  const virtualizerRef = useRef<VirtualizerHandle>(null)
  const minimapRef = useRef<ChatMinimapHandle>(null)
  const isAtBottomRef = useRef(true)
  const shouldFollowBottomRef = useRef(true)
  const initialScrollDoneRef = useRef(false)
  const messageIdsRef = useRef(messageIds)
  const sessionIdRef = useRef(sessionId)
  const metricsRef = useRef<ChatScrollMetrics>(EMPTY_SCROLL_METRICS)
  const composerInsetHeightRef = useRef(0)
  const minimapRafIdRef = useRef(0)
  const followBottomRafIdRef = useRef(0)
  const initialBottomRafIdRef = useRef(0)
  const programmaticScrollRafIdRef = useRef(0)
  const isProgrammaticScrollRef = useRef(false)
  const lastScrollOffsetRef = useRef(0)
  const lastTouchYRef = useRef<number | null>(null)
  const wasActiveRef = useRef(active)
  const [metrics, setMetrics] = useState<ChatScrollMetrics>(EMPTY_SCROLL_METRICS)

  useEffect(() => {
    messageIdsRef.current = messageIds
  }, [messageIds])

  useEffect(() => {
    if (initialBottomRafIdRef.current !== 0) {
      cancelAnimationFrame(initialBottomRafIdRef.current)
    }
    if (followBottomRafIdRef.current !== 0) {
      cancelAnimationFrame(followBottomRafIdRef.current)
    }
    if (programmaticScrollRafIdRef.current !== 0) {
      cancelAnimationFrame(programmaticScrollRafIdRef.current)
    }
    sessionIdRef.current = sessionId
    initialScrollDoneRef.current = false
    isAtBottomRef.current = true
    shouldFollowBottomRef.current = true
    initialBottomRafIdRef.current = 0
    followBottomRafIdRef.current = 0
    programmaticScrollRafIdRef.current = 0
    isProgrammaticScrollRef.current = false
    lastScrollOffsetRef.current = 0
    lastTouchYRef.current = null
    metricsRef.current = EMPTY_SCROLL_METRICS
    setMetrics(EMPTY_SCROLL_METRICS)
    minimapRef.current?.setActiveMessageIndex(0)
  }, [sessionId])

  useEffect(() => {
    return () => clearChatAttentionSnapshot(sessionId)
  }, [sessionId])

  const streamingMessageIds = useChatStore(useShallow(state =>
    active
      ? chatSelectors.streamingMessageIdSet(state)
      : EMPTY_STREAMING_MESSAGE_IDS))
  const keepMountedIndices = useMemo(() => {
    if (!active || streamingMessageIds.size === 0) {
      return undefined
    }

    const indices: number[] = []
    for (let i = 0; i < messageIds.length; i++) {
      if (streamingMessageIds.has(messageIds[i])) {
        indices.push(i)
      }
    }
    return indices.length > 0 ? indices : undefined
  }, [active, streamingMessageIds, messageIds])

  const readScrollMetrics = useCallback((): ChatScrollMetrics | null => {
    const viewport = viewportRef.current
    if (!viewport) {
      return null
    }

    return normalizeScrollMetrics({
      offset: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      viewportHeight: viewport.clientHeight,
    })
  }, [])

  const readScrollMetricsForOffset = useCallback((offset: number): ChatScrollMetrics | null => {
    const viewport = viewportRef.current
    if (viewport) {
      return normalizeScrollMetrics({
        offset,
        scrollHeight: viewport.scrollHeight,
        viewportHeight: viewport.clientHeight,
      })
    }

    const cachedMetrics = metricsRef.current
    if (cachedMetrics.scrollHeight > 0 || cachedMetrics.viewportHeight > 0) {
      return normalizeScrollMetrics({
        offset,
        scrollHeight: cachedMetrics.scrollHeight,
        viewportHeight: cachedMetrics.viewportHeight,
      })
    }
    return readScrollMetrics()
  }, [readScrollMetrics])

  const syncComposerInsetHeight = useCallback((): boolean => {
    const nextHeight = Math.ceil(composerOverlayRef.current?.getBoundingClientRect().height ?? 0)
    if (nextHeight === composerInsetHeightRef.current) {
      return false
    }

    composerInsetHeightRef.current = nextHeight
    scrollContainerRef.current?.style.setProperty('--chat-composer-inset', `${nextHeight}px`)
    return true
  }, [])

  useLayoutEffect(() => {
    if (!active) {
      return
    }
    syncComposerInsetHeight()
  }, [active, syncComposerInsetHeight])

  const writeChatAttentionSnapshot = useCallback((nextMetrics: ChatScrollMetrics | null) => {
    const currentSessionId = sessionIdRef.current
    const currentMessageIds = messageIdsRef.current
    if (!active || !currentSessionId || currentMessageIds.length === 0 || !nextMetrics) {
      clearChatAttentionSnapshot(currentSessionId)
      return
    }

    const visibleViewportHeight = Math.max(
      nextMetrics.viewportHeight - composerInsetHeightRef.current,
      0,
    )
    const virtualizer = virtualizerRef.current
    const firstVisibleIndex = virtualizer
      ? Math.max(0, Math.min(currentMessageIds.length - 1, virtualizer.findItemIndex(nextMetrics.offset)))
      : null
    const lastVisibleIndex = virtualizer
      ? Math.max(0, Math.min(currentMessageIds.length - 1, virtualizer.findItemIndex(nextMetrics.offset + visibleViewportHeight)))
      : null

    updateChatAttentionSnapshot(currentSessionId, {
      messageCount: currentMessageIds.length,
      firstVisibleIndex,
      lastVisibleIndex,
      scrollRatio: readScrollRatio(nextMetrics),
      isAtBottom: isAtBottomRef.current,
      updatedAt: Date.now(),
    })
  }, [active])

  const scheduleMinimapSync = useCallback((nextMetrics: ChatScrollMetrics) => {
    if (!active) {
      return
    }
    metricsRef.current = nextMetrics
    writeChatAttentionSnapshot(nextMetrics)
    const virtualizer = virtualizerRef.current
    const currentMessageIds = messageIdsRef.current
    if (virtualizer && currentMessageIds.length > 0) {
      const activeMessageIndex = Math.max(
        0,
        Math.min(currentMessageIds.length - 1, virtualizer.findItemIndex(nextMetrics.offset)),
      )
      minimapRef.current?.setActiveMessageIndex(activeMessageIndex)
    }

    // Throttle React state update to one per frame (for ChatMinimap consumers)
    if (minimapRafIdRef.current === 0) {
      minimapRafIdRef.current = requestAnimationFrame(() => {
        minimapRafIdRef.current = 0
        setMetrics(metricsRef.current)
      })
    }
  }, [active, writeChatAttentionSnapshot])

  const cancelScheduledFollowBottom = useCallback(() => {
    if (followBottomRafIdRef.current !== 0) {
      cancelAnimationFrame(followBottomRafIdRef.current)
      followBottomRafIdRef.current = 0
    }
  }, [])

  const cancelInitialBottomScroll = useCallback(() => {
    if (initialBottomRafIdRef.current !== 0) {
      cancelAnimationFrame(initialBottomRafIdRef.current)
      initialBottomRafIdRef.current = 0
    }
  }, [])

  const clearProgrammaticScroll = useCallback(() => {
    if (programmaticScrollRafIdRef.current !== 0) {
      cancelAnimationFrame(programmaticScrollRafIdRef.current)
      programmaticScrollRafIdRef.current = 0
    }
    isProgrammaticScrollRef.current = false
  }, [])

  const cancelScheduledMeasurements = useCallback(() => {
    if (minimapRafIdRef.current !== 0) {
      cancelAnimationFrame(minimapRafIdRef.current)
      minimapRafIdRef.current = 0
    }
    cancelScheduledFollowBottom()
    cancelInitialBottomScroll()
    clearProgrammaticScroll()
  }, [cancelInitialBottomScroll, cancelScheduledFollowBottom, clearProgrammaticScroll])

  const markProgrammaticScroll = useCallback(() => {
    if (programmaticScrollRafIdRef.current !== 0) {
      cancelAnimationFrame(programmaticScrollRafIdRef.current)
    }
    isProgrammaticScrollRef.current = true
    programmaticScrollRafIdRef.current = requestAnimationFrame(() => {
      programmaticScrollRafIdRef.current = requestAnimationFrame(() => {
        programmaticScrollRafIdRef.current = 0
        isProgrammaticScrollRef.current = false
      })
    })
  }, [])

  const detachFromBottomFollow = useCallback(() => {
    shouldFollowBottomRef.current = false
    cancelInitialBottomScroll()
    cancelScheduledFollowBottom()
  }, [cancelInitialBottomScroll, cancelScheduledFollowBottom])

  const commitScrollMetrics = useCallback((nextMetrics: ChatScrollMetrics, options?: { source?: 'layout' | 'programmatic' | 'scroll' }) => {
    if (!active) {
      return
    }
    const metrics = normalizeScrollMetrics(nextMetrics)
    const scrolledUp = metrics.offset < lastScrollOffsetRef.current - 1
    const isAtBottom = readIsAtBottom(metrics)
    const isUserScroll = options?.source === 'scroll' && !isProgrammaticScrollRef.current

    isAtBottomRef.current = isAtBottom
    if (isUserScroll && scrolledUp && !isAtBottom) {
      detachFromBottomFollow()
    }
    else if (isAtBottom) {
      shouldFollowBottomRef.current = true
    }

    lastScrollOffsetRef.current = metrics.offset
    scheduleMinimapSync(metrics)
  }, [active, detachFromBottomFollow, scheduleMinimapSync])

  const scrollToBottom = useCallback(() => {
    if (!active) {
      return
    }
    const viewport = viewportRef.current
    if (viewport) {
      markProgrammaticScroll()
      viewport.scrollTop = Math.max(viewport.scrollHeight - viewport.clientHeight, 0)
      isAtBottomRef.current = true
      shouldFollowBottomRef.current = true
      lastScrollOffsetRef.current = clampScrollOffset(
        viewport.scrollTop,
        viewport.scrollHeight,
        viewport.clientHeight,
      )
    }
  }, [active, markProgrammaticScroll])

  const scheduleFollowBottom = useCallback(() => {
    if (!active) {
      return
    }
    if (followBottomRafIdRef.current !== 0) {
      return
    }

    followBottomRafIdRef.current = requestAnimationFrame(() => {
      followBottomRafIdRef.current = 0
      if (!shouldFollowBottomRef.current) {
        return
      }

      scrollToBottom()
      const nextMetrics = readScrollMetrics()
      if (nextMetrics) {
        commitScrollMetrics(nextMetrics, { source: 'programmatic' })
      }
    })
  }, [active, commitScrollMetrics, readScrollMetrics, scrollToBottom])

  useEffect(() => {
    if (active) {
      return
    }
    cancelScheduledMeasurements()
    clearChatAttentionSnapshot(sessionIdRef.current)
  }, [active, cancelScheduledMeasurements])

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) {
      viewport.style.overflowAnchor = 'none'
    }
  }, [])

  useLayoutEffect(() => {
    if (!active || initialScrollDoneRef.current || messageIds.length === 0) {
      return
    }

    initialScrollDoneRef.current = true
    shouldFollowBottomRef.current = true
    virtualizerRef.current?.scrollToIndex(messageIds.length - 1, { align: 'end' })
    scrollToBottom()
    initialBottomRafIdRef.current = requestAnimationFrame(() => {
      initialBottomRafIdRef.current = 0
      if (!shouldFollowBottomRef.current) {
        return
      }
      scrollToBottom()
      scheduleFollowBottom()
    })
  }, [active, messageIds.length, scheduleFollowBottom, scrollToBottom])

  useEffect(() => {
    if (!active || !shouldFollowBottomRef.current) {
      return
    }

    scheduleFollowBottom()
  }, [active, messageIds.length, status, scheduleFollowBottom])

  const handleVirtualScroll = useCallback((offset: number) => {
    if (!active) {
      return
    }
    const nextMetrics = readScrollMetricsForOffset(offset)
    if (!nextMetrics) {
      return
    }
    commitScrollMetrics(nextMetrics, { source: 'scroll' })
  }, [active, commitScrollMetrics, readScrollMetricsForOffset])

  const syncCurrentMetrics = useCallback(() => {
    if (!active) {
      return
    }
    const nextMetrics = readScrollMetrics()
    if (nextMetrics) {
      commitScrollMetrics(nextMetrics)
    }
  }, [active, commitScrollMetrics, readScrollMetrics])

  const handleTranscriptLayoutChange = useCallback(() => {
    if (!active) {
      return
    }
    if (shouldFollowBottomRef.current) {
      scheduleFollowBottom()
      return
    }

    syncCurrentMetrics()
  }, [active, scheduleFollowBottom, syncCurrentMetrics])

  useLayoutEffect(() => {
    const wasActive = wasActiveRef.current
    wasActiveRef.current = active
    if (!active) {
      return
    }
    if (wasActive || messageIds.length === 0) {
      return
    }

    syncComposerInsetHeight()
    if (!shouldFollowBottomRef.current && !isAtBottomRef.current) {
      syncCurrentMetrics()
      return
    }

    scrollToBottom()
    scheduleFollowBottom()
  }, [
    active,
    messageIds.length,
    scheduleFollowBottom,
    scrollToBottom,
    syncComposerInsetHeight,
    syncCurrentMetrics,
  ])

  useLayoutEffect(() => {
    if (!active || !initialScrollDoneRef.current) {
      return
    }
    if (messageIds.length === 0) {
      syncCurrentMetrics()
      return
    }
    if (shouldFollowBottomRef.current) {
      scrollToBottom()
      scheduleFollowBottom()
      return
    }
    syncCurrentMetrics()
  }, [active, messageIds.length, scheduleFollowBottom, scrollToBottom, syncCurrentMetrics])

  const getTranscriptContentElement = useCallback(() => {
    const viewport = viewportRef.current
    return viewport?.firstElementChild instanceof HTMLElement
      ? viewport.firstElementChild
      : null
  }, [])

  // Event-driven scroll observation — replaces the rAF loop
  useEffect(() => {
    const viewport = viewportRef.current
    if (!active || !viewport) {
      return
    }

    let lastScrollHeight = viewport.scrollHeight
    let observedTranscriptContent: HTMLElement | null = null
    let observedComposerOverlay: HTMLElement | null = null
    let transcriptMutationFrameId = 0

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        detachFromBottomFollow()
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      lastTouchYRef.current = event.touches[0]?.clientY ?? null
    }

    const onTouchMove = (event: TouchEvent) => {
      const nextTouchY = event.touches[0]?.clientY ?? null
      const lastTouchY = lastTouchYRef.current
      if (nextTouchY !== null && lastTouchY !== null && nextTouchY > lastTouchY + 1) {
        detachFromBottomFollow()
      }
      lastTouchYRef.current = nextTouchY
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') {
        detachFromBottomFollow()
      }
    }

    const onScroll = () => {
      const nextMetrics = readScrollMetricsForOffset(viewport.scrollTop)
      if (nextMetrics) {
        commitScrollMetrics(nextMetrics, { source: 'scroll' })
      }
    }

    const onResize = () => {
      const composerInsetChanged = syncComposerInsetHeight()
      const scrollHeight = viewport.scrollHeight
      const viewportHeight = viewport.clientHeight

      if (scrollHeight !== lastScrollHeight || composerInsetChanged) {
        handleTranscriptLayoutChange()
      }
      lastScrollHeight = scrollHeight

      commitScrollMetrics({ offset: viewport.scrollTop, scrollHeight, viewportHeight }, { source: 'layout' })
    }

    const resizeObserver = new ResizeObserver(onResize)

    const observeTranscriptContent = () => {
      const transcriptContent = getTranscriptContentElement()
      if (transcriptContent === observedTranscriptContent) {
        return
      }
      if (observedTranscriptContent) {
        resizeObserver.unobserve(observedTranscriptContent)
      }
      observedTranscriptContent = transcriptContent
      if (observedTranscriptContent) {
        resizeObserver.observe(observedTranscriptContent)
      }
    }

    const observeComposerOverlay = () => {
      const composerOverlay = composerOverlayRef.current
      if (composerOverlay === observedComposerOverlay) {
        return
      }
      if (observedComposerOverlay) {
        resizeObserver.unobserve(observedComposerOverlay)
      }
      observedComposerOverlay = composerOverlay
      if (observedComposerOverlay) {
        resizeObserver.observe(observedComposerOverlay)
      }
    }

    const flushTranscriptMutation = () => {
      transcriptMutationFrameId = 0
      observeTranscriptContent()
      observeComposerOverlay()
      handleTranscriptLayoutChange()
    }

    const onTranscriptMutation = () => {
      if (transcriptMutationFrameId !== 0) {
        return
      }
      transcriptMutationFrameId = requestAnimationFrame(flushTranscriptMutation)
    }

    viewport.addEventListener('wheel', onWheel, { capture: true, passive: true })
    viewport.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    viewport.addEventListener('touchmove', onTouchMove, { capture: true, passive: true })
    viewport.addEventListener('keydown', onKeyDown, { capture: true })
    viewport.addEventListener('scroll', onScroll, { passive: true })
    resizeObserver.observe(viewport)
    syncComposerInsetHeight()
    observeTranscriptContent()
    observeComposerOverlay()

    const mutationObserver = new MutationObserver(onTranscriptMutation)
    mutationObserver.observe(viewport, {
      childList: true,
      subtree: true,
    })

    syncCurrentMetrics()

    return () => {
      viewport.removeEventListener('wheel', onWheel, { capture: true })
      viewport.removeEventListener('touchstart', onTouchStart, { capture: true })
      viewport.removeEventListener('touchmove', onTouchMove, { capture: true })
      viewport.removeEventListener('keydown', onKeyDown, { capture: true })
      viewport.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      if (transcriptMutationFrameId !== 0) {
        cancelAnimationFrame(transcriptMutationFrameId)
        transcriptMutationFrameId = 0
      }
      cancelScheduledMeasurements()
    }
  }, [
    active,
    cancelScheduledMeasurements,
    commitScrollMetrics,
    detachFromBottomFollow,
    getTranscriptContentElement,
    handleTranscriptLayoutChange,
    readScrollMetricsForOffset,
    syncComposerInsetHeight,
    syncCurrentMetrics,
  ])

  const handleComposerFocusChange = useCallback((focused: boolean) => {
    if (!active) {
      return
    }
    updateChatAttentionSnapshot(sessionIdRef.current, {
      focusedArea: focused ? 'composer' : null,
      updatedAt: Date.now(),
    })
  }, [active])

  useEffect(() => {
    if (!active) {
      return
    }
    syncCurrentMetrics()
  }, [active, messageIds.length, syncCurrentMetrics])

  const scrollToMessageIndex = useCallback((index: number) => {
    if (!active) {
      return
    }
    const virtualizer = virtualizerRef.current
    const viewport = viewportRef.current
    if (!virtualizer || !viewport) {
      return
    }
    shouldFollowBottomRef.current = false
    markProgrammaticScroll()
    virtualizer.scrollToIndex(index, { align: 'start', smooth: true })
  }, [active, markProgrammaticScroll])

  const scrollToOffset = useCallback((offset: number) => {
    if (!active) {
      return
    }
    const viewport = viewportRef.current
    if (viewport) {
      const nextOffset = clampScrollOffset(offset, viewport.scrollHeight, viewport.clientHeight)
      shouldFollowBottomRef.current = nextOffset + viewport.clientHeight >= viewport.scrollHeight - BOTTOM_PROXIMITY_PX
      markProgrammaticScroll()
      viewport.scrollTop = nextOffset
    }
  }, [active, markProgrammaticScroll])

  return {
    scrollContainerRef,
    viewportRef,
    composerOverlayRef,
    virtualizerRef,
    minimapRef,
    keepMountedIndices,
    metrics,
    handleVirtualScroll,
    scrollToMessageIndex,
    scrollToOffset,
    handleComposerFocusChange,
  }
}
