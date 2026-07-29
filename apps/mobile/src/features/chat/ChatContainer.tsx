import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { Stack } from 'expo-router'
import { useEffect, useRef, useState } from 'react'

import type {
  GetChatSessionsBySessionIdMessagesResponse,
  GetChatSessionsBySessionIdQueueResponse,
  GetChatSessionsBySessionIdRunSnapshotsResponse,
  GetSessionsResponse,
} from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest, cradleStreamResponse } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

import { consumeChatMessageStream } from './chat-stream'
import { ChatView } from './ChatView'

export function ChatContainer({ sessionId }: { sessionId: string }) {
  const { connection } = useConnection()
  const queryClient = useQueryClient()
  const activeStreamRef = useRef<AbortController | null>(null)
  const streamingMessageIdRef = useRef<string | null>(null)
  const [isLiveStreaming, setIsLiveStreaming] = useState(false)
  const [liveMessage, setLiveMessage] = useState<UIMessage | null>(null)
  const [pendingUser, setPendingUser] = useState<{ id: string | null, text: string } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const query = useQuery({
    enabled: Boolean(connection),
    queryKey: ['chat', connection?.url, sessionId],
    queryFn: async () => {
      const [session, messages, snapshots, queue] = await Promise.all([
        cradleRequest<GetSessionsResponse[number]>(connection!, `/sessions/${encodeURIComponent(sessionId)}`),
        cradleRequest<GetChatSessionsBySessionIdMessagesResponse>(
          connection!,
          `/chat/sessions/${encodeURIComponent(sessionId)}/messages?limit=200`,
        ),
        cradleRequest<GetChatSessionsBySessionIdRunSnapshotsResponse>(
          connection!,
          `/chat/sessions/${encodeURIComponent(sessionId)}/run-snapshots`,
        ),
        cradleRequest<GetChatSessionsBySessionIdQueueResponse>(
          connection!,
          `/chat/sessions/${encodeURIComponent(sessionId)}/queue`,
        ),
      ])
      return {
        session,
        messages: messages.rows,
        queue: queue.items,
        snapshots: snapshots.snapshots,
      }
    },
    refetchInterval: data => data.state.data?.session.status === 'streaming' ? 15_000 : false,
  })
  const sessionStatus = query.data?.session.status
  const streamingMessageId = query.data?.messages
    .findLast(row => row.role === 'assistant' && row.status === 'streaming')
    ?.messageId ?? null
  streamingMessageIdRef.current = streamingMessageId
  const refetchChat = query.refetch

  useEffect(() => () => {
    activeStreamRef.current?.abort()
  }, [])

  useEffect(() => {
    if (
      !connection
      || sessionStatus !== 'streaming'
      || activeStreamRef.current
    ) {
      return
    }

    const controller = new AbortController()
    activeStreamRef.current = controller
    setIsLiveStreaming(true)
    setSendError(null)

    void cradleStreamResponse(
      connection,
      `/chat/sessions/${encodeURIComponent(sessionId)}/stream`,
      { signal: controller.signal },
    )
      .then(response => consumeChatMessageStream({
        messageId: streamingMessageIdRef.current ?? `assistant-${sessionId}`,
        onMessage: setLiveMessage,
        response,
      }))
      .catch((error: Error) => {
        if (!controller.signal.aborted) {
          setSendError(errorMessage(error))
        }
      })
      .finally(async () => {
        if (activeStreamRef.current !== controller) {
          return
        }
        activeStreamRef.current = null
        setIsLiveStreaming(false)
        const result = await refetchChat()
        if (result.isSuccess) {
          setLiveMessage(null)
        }
      })

    return () => {
      controller.abort()
      if (activeStreamRef.current === controller) {
        activeStreamRef.current = null
      }
      setIsLiveStreaming(false)
    }
  }, [connection, refetchChat, sessionId, sessionStatus])

  const send = useMutation({
    mutationFn: async (text: string) => {
      setSendError(null)
      const controller = new AbortController()
      activeStreamRef.current = controller
      setIsLiveStreaming(true)
      setLiveMessage(null)
      setPendingUser({ id: null, text })

      try {
        const response = await cradleStreamResponse(
          connection!,
          `/chat/sessions/${encodeURIComponent(sessionId)}/response`,
          {
            body: { text },
            method: 'POST',
            signal: controller.signal,
          },
        )
        const assistantMessageId = response.headers.get('x-cradle-assistant-message-id')
          ?? `assistant-${sessionId}`
        setPendingUser({
          id: response.headers.get('x-cradle-user-message-id'),
          text,
        })
        await consumeChatMessageStream({
          messageId: assistantMessageId,
          onMessage: setLiveMessage,
          response,
        })
      }
      finally {
        if (activeStreamRef.current === controller) {
          activeStreamRef.current = null
        }
        setIsLiveStreaming(false)
      }
    },
    onError: error => setSendError(errorMessage(error)),
    onSettled: async () => {
      const result = await query.refetch()
      if (result.isSuccess) {
        setLiveMessage(null)
        setPendingUser(null)
      }
    },
  })

  const queue = useMutation({
    mutationFn: (text: string) => cradleRequest(
      connection!,
      `/chat/sessions/${encodeURIComponent(sessionId)}/queue`,
      { method: 'POST', body: { text } },
    ),
    onError: error => setSendError(errorMessage(error)),
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: ['chat', connection?.url, sessionId],
    }),
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
  const isStreaming = isLiveStreaming || query.data.session.status === 'streaming'
  const queuedCount = query.data.queue.filter(item => item.status === 'pending').length
  return (
    <>
      <Stack.Screen options={{ title: query.data.session.title ?? 'Conversation' }} />
      <ChatView
        activeRun={activeRun}
        isCancelling={cancel.isPending}
        isSending={send.isPending || queue.isPending}
        isStreaming={isStreaming}
        liveMessage={liveMessage}
        messages={query.data.messages}
        onCancel={() => cancel.mutate()}
        onSend={text => isStreaming ? queue.mutate(text) : send.mutate(text)}
        pendingUser={pendingUser}
        queuedCount={queuedCount}
        sendError={sendError}
        session={query.data.session}
      />
    </>
  )
}
