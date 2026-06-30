import type { ContextItem } from '~/features/context/context-items'
import { estimateContextTokens } from '~/features/context/context-items'
import type { ContextProvider } from '~/features/context/context-registry'
import { clampRatio } from '~/lib/number-format'

export interface ChatAttentionSnapshot {
  sessionId: string
  messageCount: number
  firstVisibleIndex: number | null
  lastVisibleIndex: number | null
  scrollRatio: number
  isAtBottom: boolean
  focusedArea: 'composer' | 'message-list' | null
  updatedAt: number
}

const snapshotsBySessionId = new Map<string, ChatAttentionSnapshot>()
const listeners = new Set<() => void>()

function publishSnapshotChange(): void {
  for (const listener of listeners) {
    listener()
  }
}

function createChatContextItem(snapshot: ChatAttentionSnapshot, now: number): ContextItem {
  const visibleRange = snapshot.firstVisibleIndex !== null && snapshot.lastVisibleIndex !== null
    ? `visible messages: ${snapshot.firstVisibleIndex + 1}-${snapshot.lastVisibleIndex + 1} of ${snapshot.messageCount}`
    : `messages: ${snapshot.messageCount}`
  const scrollSummary = snapshot.isAtBottom
    ? 'User is near the latest messages.'
    : 'User manually scrolled away from the latest messages.'
  const focusSummary = snapshot.focusedArea
    ? `Focused area: ${snapshot.focusedArea}.`
    : 'No focused chat sub-area is known.'
  const summary = `${scrollSummary} ${focusSummary}`
  const content = `${visibleRange}; scroll progress: ${Math.round(snapshot.scrollRatio * 100)}%`

  return {
    id: `chat:attention:${snapshot.sessionId}`,
    kind: 'attention',
    owner: 'chat',
    title: 'Chat attention',
    summary,
    content,
    references: [{
      kind: 'chat-session',
      id: snapshot.sessionId,
      label: snapshot.sessionId,
    }],
    priority: snapshot.isAtBottom ? 65 : 90,
    freshness: now - snapshot.updatedAt <= 5_000 ? 'live' : 'recent',
    sensitivity: 'private',
    tokenEstimate: estimateContextTokens(`${summary}\n${content}`),
    createdAt: now,
  }
}

export function updateChatAttentionSnapshot(
  sessionId: string | null,
  patch: Partial<Omit<ChatAttentionSnapshot, 'sessionId'>>,
): void {
  if (!sessionId) {
    return
  }

  const current = snapshotsBySessionId.get(sessionId)
  snapshotsBySessionId.set(sessionId, {
    sessionId,
    messageCount: patch.messageCount ?? current?.messageCount ?? 0,
    firstVisibleIndex: patch.firstVisibleIndex ?? current?.firstVisibleIndex ?? null,
    lastVisibleIndex: patch.lastVisibleIndex ?? current?.lastVisibleIndex ?? null,
    scrollRatio: clampRatio(patch.scrollRatio ?? current?.scrollRatio ?? 0),
    isAtBottom: patch.isAtBottom ?? current?.isAtBottom ?? true,
    focusedArea: patch.focusedArea ?? current?.focusedArea ?? null,
    updatedAt: patch.updatedAt ?? Date.now(),
  })
  publishSnapshotChange()
}

export function clearChatAttentionSnapshot(sessionId: string | null): void {
  if (!sessionId) {
    return
  }
  if (snapshotsBySessionId.delete(sessionId)) {
    publishSnapshotChange()
  }
}

export function readChatAttentionSnapshot(sessionId: string | null): ChatAttentionSnapshot | null {
  if (!sessionId) {
    return null
  }
  return snapshotsBySessionId.get(sessionId) ?? null
}

export function subscribeChatAttentionSnapshots(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function createChatContextProvider(): ContextProvider {
  return {
    owner: 'chat',
    readContext(input) {
      if (input.activeSurfaceType !== 'chat') {
        return []
      }

      const sessionId = input.activeSurfaceParams.sessionId
      if (!sessionId) {
        return []
      }

      const snapshot = snapshotsBySessionId.get(sessionId)
      if (!snapshot) {
        return []
      }

      return [createChatContextItem(snapshot, input.now)]
    },
  }
}
