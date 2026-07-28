import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'

import type {
  GetChatSessionsBySessionIdMessagesResponse,
  GetChatSessionsBySessionIdRunSnapshotsResponse,
  GetSessionsResponse,
} from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest, cradleStreamRequest } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

import { ChatView } from './ChatView'

export function ChatContainer({ sessionId }: { sessionId: string }) {
  const { connection } = useConnection()
  const queryClient = useQueryClient()
  const [sendError, setSendError] = useState<string | null>(null)
  const query = useQuery({
    enabled: Boolean(connection),
    queryKey: ['chat', connection?.url, sessionId],
    queryFn: async () => {
      const [session, messages, snapshots] = await Promise.all([
        cradleRequest<GetSessionsResponse[number]>(connection!, `/sessions/${encodeURIComponent(sessionId)}`),
        cradleRequest<GetChatSessionsBySessionIdMessagesResponse>(
          connection!,
          `/chat/sessions/${encodeURIComponent(sessionId)}/messages?limit=200`,
        ),
        cradleRequest<GetChatSessionsBySessionIdRunSnapshotsResponse>(
          connection!,
          `/chat/sessions/${encodeURIComponent(sessionId)}/run-snapshots`,
        ),
      ])
      return { session, messages: messages.rows, snapshots: snapshots.snapshots }
    },
    refetchInterval: data => data.state.data?.session.status === 'streaming' ? 1_500 : 8_000,
  })

  const send = useMutation({
    mutationFn: async (text: string) => {
      setSendError(null)
      if (query.data?.session.status === 'streaming') {
        await cradleRequest(
          connection!,
          `/chat/sessions/${encodeURIComponent(sessionId)}/queue`,
          { method: 'POST', body: { text } },
        )
      }
      else {
        await cradleStreamRequest(
          connection!,
          `/chat/sessions/${encodeURIComponent(sessionId)}/response`,
          { text },
        )
      }
    },
    onError: error => setSendError(errorMessage(error)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['chat', connection?.url, sessionId] }),
  })

  const cancel = useMutation({
    mutationFn: () => cradleRequest(
      connection!,
      `/chat/sessions/${encodeURIComponent(sessionId)}/cancel`,
      { method: 'POST' },
    ),
    onSettled: () => void query.refetch(),
  })

  if (query.isPending) { return <LoadingState /> }
  if (query.error) { return <ErrorState title="Could not open conversation" description={errorMessage(query.error)} /> }
  const activeRun = [...query.data.snapshots].reverse().find(snapshot => snapshot.status === 'running')
  return (
    <ChatView
      activeRun={activeRun}
      isSending={send.isPending}
      messages={query.data.messages}
      onBack={() => router.back()}
      onCancel={() => cancel.mutate()}
      onSend={text => send.mutate(text)}
      sendError={sendError}
      session={query.data.session}
    />
  )
}
