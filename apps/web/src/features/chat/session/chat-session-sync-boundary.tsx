import { useLayoutEffect } from 'react'

import { chatSelectors, useChatStore } from '~/store/chat'

import { useChatSessionDriver } from './use-chat-session-driver'

const mountedSessionSyncCounts = new Map<string, number>()
const pendingSessionCacheReleaseDisposers = new Map<string, () => void>()

export function ChatSessionSyncBoundary({
  sessionId,
  active,
}: {
  sessionId: string
  active: boolean
}) {
  useChatSessionDriver(sessionId, active)

  useLayoutEffect(() => {
    retainSessionCache(sessionId)
    return () => releaseSessionCache(sessionId)
  }, [sessionId])

  return null
}
ChatSessionSyncBoundary.displayName = 'ChatSessionSyncBoundary'

function retainSessionCache(sessionId: string): void {
  pendingSessionCacheReleaseDisposers.get(sessionId)?.()
  pendingSessionCacheReleaseDisposers.delete(sessionId)
  mountedSessionSyncCounts.set(sessionId, (mountedSessionSyncCounts.get(sessionId) ?? 0) + 1)
}

function releaseSessionCache(sessionId: string): void {
  const nextCount = (mountedSessionSyncCounts.get(sessionId) ?? 1) - 1
  if (nextCount > 0) {
    mountedSessionSyncCounts.set(sessionId, nextCount)
    return
  }

  mountedSessionSyncCounts.delete(sessionId)
  releaseSessionCacheWhenIdle(sessionId)
}

function releaseSessionCacheWhenIdle(sessionId: string): void {
  const release = () => {
    pendingSessionCacheReleaseDisposers.get(sessionId)?.()
    pendingSessionCacheReleaseDisposers.delete(sessionId)
    useChatStore.getState().clearSession(sessionId)
  }

  if (!chatSelectors.isSessionStreaming(sessionId)(useChatStore.getState())) {
    release()
    return
  }

  const unsubscribe = useChatStore.subscribe((state) => {
    if ((mountedSessionSyncCounts.get(sessionId) ?? 0) > 0) {
      unsubscribe()
      pendingSessionCacheReleaseDisposers.delete(sessionId)
      return
    }
    if (chatSelectors.isSessionStreaming(sessionId)(state)) {
      return
    }
    release()
  })
  pendingSessionCacheReleaseDisposers.set(sessionId, unsubscribe)
}
