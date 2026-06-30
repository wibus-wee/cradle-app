import { useCallback, useEffect, useRef } from 'react'

const scrollPositions = new Map<string, number>()

interface UseTopicScrollPersistOptions {
  /** Unique key for current context (e.g. `${agentId}:${topicId}:${threadId}`) */
  contextKey: string
  /** Ref to scrollable container */
  containerRef: React.RefObject<HTMLElement | null>
  /** Whether to restore position on key change */
  restoreOnChange?: boolean
}

/**
 * Persists and restores scroll position per context key.
 * Saves position on key change or unmount, restores on mount or key change.
 */
export function useTopicScrollPersist({
  contextKey,
  containerRef,
  restoreOnChange = true,
}: UseTopicScrollPersistOptions) {
  const prevKeyRef = useRef(contextKey)

  const save = useCallback(() => {
    const el = containerRef.current
    if (el) {
      scrollPositions.set(prevKeyRef.current, el.scrollTop)
    }
  }, [containerRef])

  const restore = useCallback(() => {
    const el = containerRef.current
    if (!el || !restoreOnChange) {
      return
    }
    const saved = scrollPositions.get(contextKey)
    if (saved !== undefined) {
      requestAnimationFrame(() => {
        el.scrollTop = saved
      })
    }
  }, [containerRef, contextKey, restoreOnChange])

  useEffect(() => {
    if (prevKeyRef.current !== contextKey) {
      save()
      prevKeyRef.current = contextKey
      restore()
    }
  }, [contextKey, save, restore])

  // Save on unmount
  useEffect(() => {
    return () => {
      save()
    }
  }, [save])
}

/** Clear all persisted positions */
export function clearScrollPositions() {
  scrollPositions.clear()
}

/** Get persisted position for a key */
export function getPersistedScrollPosition(key: string): number | undefined {
  return scrollPositions.get(key)
}
