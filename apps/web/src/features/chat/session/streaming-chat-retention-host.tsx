import { shallow } from 'zustand/shallow'

import { useActiveSurface } from '~/navigation/active-surface'
import { chatSessionIdForSurface } from '~/navigation/surface-identity'
import { useChatStore } from '~/store/chat'

import { ChatSessionSyncBoundary } from './chat-session-sync-boundary'
import { readRetainableStreamingSessionIds } from './streaming-session-retention'

function useStreamingSessionIds(): string[] {
  return useChatStore(readRetainableStreamingSessionIds, shallow)
}

function useActiveChatSessionId(): string | null {
  return chatSessionIdForSurface(useActiveSurface())
}

function RetainedStreamingChatSession({ sessionId }: { sessionId: string }) {
  return <ChatSessionSyncBoundary sessionId={sessionId} active />
}

export function StreamingChatRetentionHost() {
  const streamingSessionIds = useStreamingSessionIds()
  const activeChatSessionId = useActiveChatSessionId()
  const retainedSessionIds = streamingSessionIds.filter(sessionId => sessionId !== activeChatSessionId)

  if (retainedSessionIds.length === 0) {
    return null
  }

  return (
    <div
      aria-hidden="true"
      className="fixed left-0 top-0 h-0 w-0 overflow-hidden"
      data-streaming-chat-retention-host=""
    >
      {retainedSessionIds.map(sessionId => (
        <RetainedStreamingChatSession key={sessionId} sessionId={sessionId} />
      ))}
    </div>
  )
}
