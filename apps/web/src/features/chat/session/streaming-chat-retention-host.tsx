import { useQuery } from '@tanstack/react-query'
import { shallow } from 'zustand/shallow'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { useActiveSurface } from '~/navigation/active-surface'
import { chatSessionIdForSurface } from '~/navigation/surface-identity'
import { useChatStore } from '~/store/chat'

import type { ChatSessionFrameDescriptor } from './chat-session-frame-host'
import { ChatSessionFrameHost } from './chat-session-frame-host'
import { getRemoteHostId } from './session-execution'
import { readSessionThinkingEffort } from './session-thinking-effort'
import { readRetainableStreamingSessionIds } from './streaming-session-retention'

function useStreamingSessionIds(): string[] {
  return useChatStore(readRetainableStreamingSessionIds, shallow)
}

function useActiveChatSessionId(): string | null {
  return chatSessionIdForSurface(useActiveSurface())
}

function RetainedStreamingChatSession({ sessionId }: { sessionId: string }) {
  const { data: session } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId } }),
    enabled: !!sessionId,
    staleTime: 60_000,
  })

  const descriptor: ChatSessionFrameDescriptor = {
    sessionId,
    sessionProviderTargetId: session?.providerTargetId ?? null,
    sessionModelId: session?.modelId ?? null,
    sessionThinkingEffort: readSessionThinkingEffort(session?.thinkingEffort),
    runtimeKind: session?.runtimeKind,
    workspaceId: session?.workspaceId ?? null,
    agentId: session?.agentId ?? null,
    remoteHostId: getRemoteHostId(session),
  }

  return <ChatSessionFrameHost activeSession={descriptor} active={false} />
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
