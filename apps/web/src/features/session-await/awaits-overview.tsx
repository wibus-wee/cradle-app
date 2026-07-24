import { useQuery, useQueryClient } from '@tanstack/react-query'

import { prefetchChatSession } from '~/features/chat/session/chat-session-prefetch'
import { readDesktopAwaits } from '~/features/desktop-tray/api'
import { openChatSession } from '~/navigation/navigation-commands'

import { AwaitsOverviewView } from './awaits-overview-view'

export function AwaitsOverview() {
  const queryClient = useQueryClient()
  const awaitsQuery = useQuery({
    queryKey: ['desktop', 'awaits'],
    queryFn: readDesktopAwaits,
    refetchInterval: 15_000,
    staleTime: 5_000,
  })

  const preloadChatSession = (sessionId: string) => {
    prefetchChatSession(queryClient, sessionId)
  }

  const openChat = (sessionId: string) => {
    preloadChatSession(sessionId)
    openChatSession(sessionId)
  }

  return (
    <AwaitsOverviewView
      awaits={awaitsQuery.data ?? []}
      isReady={awaitsQuery.isSuccess}
      hasError={awaitsQuery.isError}
      onOpenChat={openChat}
      onPreloadChat={preloadChatSession}
    />
  )
}
