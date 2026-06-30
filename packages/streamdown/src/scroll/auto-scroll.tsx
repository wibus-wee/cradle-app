import * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'

import { useScrollIntent } from './scroll-intent'
import { useSpringScroll } from './spring-scroll'

interface AutoScrollProps {
  /** Ref to scrollable container */
  containerRef: React.RefObject<HTMLElement | null>
  /** Whether content is being generated */
  generating: boolean
  /** Whether auto-scroll is enabled (user preference) */
  enabled?: boolean
  /** Distance from bottom to consider "at bottom" */
  threshold?: number
  children?: React.ReactNode
}

/**
 * Headless auto-scroll manager.
 * Triggers spring scroll-to-bottom when:
 * - generating === true
 * - user is NOT actively scrolling
 * - container is within threshold of bottom (or was at bottom when generation started)
 *
 * Monitors content changes via MutationObserver on container.
 */
export function AutoScroll({
  containerRef,
  generating,
  enabled = true,
  threshold = 50,
  children,
}: AutoScrollProps): React.ReactElement {
  const { isUserScrolling, reset: resetIntent } = useScrollIntent(containerRef)
  const { scrollToBottom, stop } = useSpringScroll(containerRef)
  const wasAtBottomRef = useRef(true)
  const mutationObsRef = useRef<MutationObserver | null>(null)

  const isNearBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return true
    }
    const maxScroll = container.scrollHeight - container.clientHeight
    return maxScroll - container.scrollTop <= threshold
  }, [containerRef, threshold])

  // Track whether we were at bottom when generation started
  useEffect(() => {
    if (generating) {
      wasAtBottomRef.current = isNearBottom()
      // Reset user intent when new generation starts
      resetIntent()
    }
  }, [generating, isNearBottom, resetIntent])

  // Main auto-scroll logic: respond to content mutations
  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled || !generating) {
      mutationObsRef.current?.disconnect()
      mutationObsRef.current = null
      return
    }

    const shouldScroll = () => {
      if (!enabled || !generating) {
        return false
      }
      if (isUserScrolling) {
        return false
      }
      if (!wasAtBottomRef.current && !isNearBottom()) {
        return false
      }
      return true
    }

    const onMutation = () => {
      if (shouldScroll()) {
        scrollToBottom()
      }
    }

    mutationObsRef.current = new MutationObserver(onMutation)
    mutationObsRef.current.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    // Initial scroll when generation starts
    if (shouldScroll()) {
      scrollToBottom()
    }

    return () => {
      mutationObsRef.current?.disconnect()
      mutationObsRef.current = null
    }
  }, [containerRef, generating, enabled, isUserScrolling, isNearBottom, scrollToBottom])

  // Stop animation when user takes over
  useEffect(() => {
    if (isUserScrolling) {
      stop()
    }
  }, [isUserScrolling, stop])

  return <>{children}</>
}
