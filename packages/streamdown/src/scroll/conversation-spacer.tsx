import * as React from 'react'
import { useEffect, useRef, useState } from 'react'

interface ConversationSpacerProps {
  /** Ref to the viewport container */
  containerRef: React.RefObject<HTMLElement | null>
  /** Whether generation is active */
  generating: boolean
  /** Minimum spacer height */
  minHeight?: number
}

/**
 * Spacer element injected between messages.
 * height = max(0, viewportH - lastMessageH - spacerMinH)
 * Uses ResizeObserver to track last message height.
 * When generating stops, spacer shrinks to 0 via CSS transition.
 */
export function ConversationSpacer({
  containerRef,
  generating,
  minHeight = 0,
}: ConversationSpacerProps): React.ReactElement {
  const [spacerHeight, setSpacerHeight] = useState(0)
  const observerRef = useRef<ResizeObserver | null>(null)
  const lastChildRef = useRef<Element | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const computeHeight = () => {
      const el = containerRef.current
      if (!el) {
        return
      }

      const lastChild = el.lastElementChild
      // Skip our own spacer element (identified by data attribute)
      const target = lastChild?.hasAttribute('data-conversation-spacer')
        ? lastChild.previousElementSibling
        : lastChild

      if (!target) {
        setSpacerHeight(0)
        return
      }

      const viewportH = el.clientHeight
      const lastMessageH = target.getBoundingClientRect().height
      const computed = Math.max(0, viewportH - lastMessageH - minHeight)
      setSpacerHeight(computed)
    }

    // Observe container for child size changes
    observerRef.current = new ResizeObserver(() => {
      if (generating) {
        computeHeight()
      }
    })

    // Observe the container itself for viewport size changes
    observerRef.current.observe(container)

    // Also observe children via MutationObserver to track last child changes
    const mutationObs = new MutationObserver(() => {
      const el = containerRef.current
      if (!el) {
        return
      }

      const lastChild = el.lastElementChild
      const target = lastChild?.hasAttribute('data-conversation-spacer')
        ? lastChild.previousElementSibling
        : lastChild

      // Re-observe the new last child
      if (target && target !== lastChildRef.current) {
        if (lastChildRef.current && observerRef.current) {
          observerRef.current.unobserve(lastChildRef.current)
        }
        lastChildRef.current = target
        observerRef.current?.observe(target)
      }

      if (generating) {
        computeHeight()
      }
    })

    mutationObs.observe(container, { childList: true })

    // Initial observation of last child
    const initialTarget = container.lastElementChild?.hasAttribute('data-conversation-spacer')
      ? container.lastElementChild.previousElementSibling
      : container.lastElementChild

    if (initialTarget) {
      lastChildRef.current = initialTarget
      observerRef.current.observe(initialTarget)
    }

    if (generating) {
      computeHeight()
    }

    return () => {
      observerRef.current?.disconnect()
      mutationObs.disconnect()
      lastChildRef.current = null
    }
  }, [containerRef, generating, minHeight])

  // When not generating, collapse to 0
  const height = generating ? spacerHeight : 0

  return (
    <div
      data-conversation-spacer=""
      style={{
        height: `${height}px`,
        transition: generating ? 'none' : 'height 300ms ease-out',
        flexShrink: 0,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
  )
}
