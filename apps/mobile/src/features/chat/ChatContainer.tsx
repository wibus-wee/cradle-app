import type { InfiniteData } from '@tanstack/react-query'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import * as Clipboard from 'expo-clipboard'
import { Stack } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Platform, Share } from 'react-native'

import type {
  GetChatSessionsBySessionIdCapabilitiesResponse,
  GetChatSessionsBySessionIdMessagePreviewsResponse,
  GetChatSessionsBySessionIdMessagesByMessageIdResponse,
  GetChatSessionsBySessionIdRuntimeSettingsResponse,
  GetChatSessionsBySessionIdRuntimeStatusResponse,
  GetSessionsByIdResponse,
} from '@/api-gen'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest, cradleStreamResponse } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'
import { errorMessage } from '@/lib/errors'

import { readChatHistoryCache, writeChatHistoryCache } from './chat-history-cache'
import { consumeChatMessageStream } from './chat-stream'
import type { ChatSubmitInput } from './ChatComposer'
import { ChatView } from './ChatView'
import { useComposerDraft } from './use-composer-draft'

export function ChatContainer({ sessionId }: { sessionId: string }) {
  const { connection } = useConnection()
  const queryClient = useQueryClient()
  const isRouteActive = useRouteIsActive()
  const activeStreamRef = useRef<AbortController | null>(null)
  const routeActiveRef = useRef(isRouteActive)
  const streamingMessageIdRef = useRef<string | null>(null)
  const [isLiveStreaming, setIsLiveStreaming] = useState(false)
  const [liveMessage, setLiveMessage] = useState<UIMessage | null>(null)
  const [pendingUser, setPendingUser] = useState<{ id: string | null, text: string } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [detailMessageId, setDetailMessageId] = useState<string | null>(null)
  const [cachedHistory, setCachedHistory] = useState<InfiniteData<
    GetChatSessionsBySessionIdMessagePreviewsResponse,
    string | null
  > | null>(null)
  const composerDraft = useComposerDraft(connection, sessionId, isRouteActive)
  routeActiveRef.current = isRouteActive
  const historyQueryKey = useMemo(
    () => ['chat-message-previews', connection?.url, sessionId] as const,
    [connection?.url, sessionId],
  )
  const sessionQuery = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['chat-session', connection?.url, sessionId],
    queryFn: ({ signal }) =>
      cradleRequest<GetSessionsByIdResponse>(
        connection!,
        `/sessions/${encodeURIComponent(sessionId)}`,
        { signal },
      ),
    refetchOnMount: 'always',
  })
  const historyQuery = useInfiniteQuery({
    enabled: Boolean(connection) && isRouteActive,
    initialPageParam: null as string | null,
    queryKey: historyQueryKey,
    queryFn: ({ pageParam, signal }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
      return cradleRequest<GetChatSessionsBySessionIdMessagePreviewsResponse>(
        connection!,
        `/chat/sessions/${encodeURIComponent(sessionId)}/message-previews?limit=50${cursor}`,
        { signal },
      )
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    refetchOnMount: 'always',
  })
  const runtimeStatusQuery = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['chat-runtime-status', connection?.url, sessionId],
    queryFn: ({ signal }) =>
      cradleRequest<GetChatSessionsBySessionIdRuntimeStatusResponse>(
        connection!,
        `/chat/sessions/${encodeURIComponent(sessionId)}/runtime-status`,
        { signal },
      ),
    refetchInterval: data => (data.state.data?.status === 'idle' ? false : 10_000),
  })
  const capabilitiesQuery = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['chat-capabilities', connection?.url, sessionId],
    queryFn: ({ signal }) =>
      cradleRequest<GetChatSessionsBySessionIdCapabilitiesResponse>(
        connection!,
        `/chat/sessions/${encodeURIComponent(sessionId)}/capabilities`,
        { signal },
      ),
  })
  const runtimeSettingsQuery = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['chat-runtime-settings', connection?.url, sessionId],
    queryFn: ({ signal }) =>
      cradleRequest<GetChatSessionsBySessionIdRuntimeSettingsResponse>(
        connection!,
        `/chat/sessions/${encodeURIComponent(sessionId)}/runtime-settings`,
        { signal },
      ),
  })
  const updatePin = useMutation({
    mutationFn: (pinned: boolean) =>
      cradleRequest<GetSessionsByIdResponse>(
        connection!,
        `/sessions/${encodeURIComponent(sessionId)}`,
        { body: { pinned }, method: 'PATCH' },
      ),
    onError: () => {
      Alert.alert('Could not update conversation', 'Your pin setting was not changed.')
    },
    onSuccess: (session) => {
      queryClient.setQueryData(['chat-session', connection?.url, sessionId], session)
      void queryClient.invalidateQueries({ queryKey: ['workspace', connection?.url] })
      void queryClient.invalidateQueries({ queryKey: ['projects', connection?.url] })
    },
  })
  const detailQuery = useQuery({
    enabled: Boolean(connection && detailMessageId) && isRouteActive,
    queryKey: ['chat-message-detail', connection?.url, sessionId, detailMessageId],
    queryFn: ({ signal }) =>
      cradleRequest<GetChatSessionsBySessionIdMessagesByMessageIdResponse>(
        connection!,
        `/chat/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(detailMessageId!)}`,
        { signal },
      ),
  })
  const refetchHistory = historyQuery.refetch
  const refetchRuntimeStatus = runtimeStatusQuery.refetch

  useEffect(() => {
    if (!connection) {
      setCachedHistory(null)
      return
    }
    let active = true
    void readChatHistoryCache(connection.url, sessionId).then((data) => {
      if (active) {
        setCachedHistory(data)
      }
    })
    return () => {
      active = false
    }
  }, [connection, sessionId])

  useEffect(() => {
    const queryHistoryData = historyQuery.data as
      | InfiniteData<GetChatSessionsBySessionIdMessagePreviewsResponse, string | null>
      | undefined
    if (connection && queryHistoryData) {
      void writeChatHistoryCache(connection.url, sessionId, queryHistoryData)
    }
  }, [connection, historyQuery.data, sessionId])

  const queryHistoryData = historyQuery.data as
    | InfiniteData<GetChatSessionsBySessionIdMessagePreviewsResponse, string | null>
    | undefined
  const historyData = queryHistoryData ?? cachedHistory
  const messages = useMemo(
    () => [...(historyData?.pages ?? [])].reverse().flatMap(page => page.rows),
    [historyData],
  )
  const sessionStatus = runtimeStatusQuery.data?.status ?? sessionQuery.data?.status
  const streamingMessageId
    = messages.findLast(row => row.role === 'assistant' && row.status === 'streaming')?.messageId
      ?? null
  streamingMessageIdRef.current = streamingMessageId

  useEffect(
    () => () => {
      activeStreamRef.current?.abort()
    },
    [],
  )

  useEffect(() => {
    if (isRouteActive) {
      return
    }
    activeStreamRef.current?.abort()
    activeStreamRef.current = null
    setIsLiveStreaming(false)
  }, [isRouteActive])

  useEffect(() => {
    if (!connection || !isRouteActive || sessionStatus !== 'streaming' || activeStreamRef.current) {
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
      .then(response =>
        consumeChatMessageStream({
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
        const result = await refetchHistory()
        void refetchRuntimeStatus()
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
  }, [connection, isRouteActive, refetchHistory, refetchRuntimeStatus, sessionId, sessionStatus])

  const send = useMutation({
    mutationFn: async ({ files, text }: ChatSubmitInput) => {
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
            body: { files, text },
            method: 'POST',
            signal: controller.signal,
          },
        )
        composerDraft.clearDraft()
        const assistantMessageId
          = response.headers.get('x-cradle-assistant-message-id') ?? `assistant-${sessionId}`
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
    onError: (error) => {
      if (routeActiveRef.current) {
        setSendError(errorMessage(error))
      }
    },
    onSettled: async () => {
      if (!routeActiveRef.current) {
        return
      }
      const [result] = await Promise.all([refetchHistory(), refetchRuntimeStatus()])
      if (result.isSuccess) {
        setLiveMessage(null)
        setPendingUser(null)
      }
    },
  })

  const queue = useMutation({
    mutationFn: ({ files, text }: ChatSubmitInput) =>
      cradleRequest(connection!, `/chat/sessions/${encodeURIComponent(sessionId)}/queue`, {
        method: 'POST',
        body: { files, text },
      }),
    onError: error => setSendError(errorMessage(error)),
    onSuccess: () => {
      composerDraft.clearDraft()
      void refetchRuntimeStatus()
      void refetchHistory()
    },
  })

  const steer = useMutation({
    mutationFn: ({ files, text }: ChatSubmitInput) =>
      cradleRequest(connection!, `/chat/sessions/${encodeURIComponent(sessionId)}/steer`, {
        method: 'POST',
        body: { files, text },
      }),
    onError: error => setSendError(errorMessage(error)),
    onSuccess: () => {
      composerDraft.clearDraft()
      void refetchRuntimeStatus()
      void refetchHistory()
    },
  })

  const updateRuntimeSettings = useMutation({
    mutationFn: (interactionMode: 'default' | 'plan') =>
      cradleRequest(
        connection!,
        `/chat/sessions/${encodeURIComponent(sessionId)}/runtime-settings`,
        { method: 'PATCH', body: { interactionMode } },
      ),
    onError: error => setSendError(errorMessage(error)),
    onSuccess: () => void runtimeSettingsQuery.refetch(),
  })

  const cancel = useMutation({
    mutationFn: () =>
      cradleRequest(connection!, `/chat/sessions/${encodeURIComponent(sessionId)}/cancel`, {
        method: 'POST',
      }),
    onSettled: () => {
      void refetchRuntimeStatus()
      void refetchHistory()
    },
  })

  const cancelRun = cancel.mutate
  const queueMessage = queue.mutate
  const sendMessage = send.mutate
  const steerMessage = steer.mutate
  const updateInteractionMode = updateRuntimeSettings.mutate
  const runtimeIsActive
    = isLiveStreaming
      || sessionStatus === 'streaming'
      || sessionStatus === 'waitingForUserInput'
      || sessionStatus === 'waitingForToolApproval'
  const handleCancel = useCallback(() => cancelRun(), [cancelRun])
  const handleModeChange = useCallback(
    (mode: 'build' | 'plan') => updateInteractionMode(mode === 'plan' ? 'plan' : 'default'),
    [updateInteractionMode],
  )
  const handleSend = useCallback(
    (input: ChatSubmitInput) => {
      if (!runtimeIsActive) {
        sendMessage(input)
      }
      else if (input.continuationMode === 'steer') {
        steerMessage(input)
      }
      else {
        queueMessage(input)
      }
    },
    [queueMessage, runtimeIsActive, sendMessage, steerMessage],
  )

  const error = sessionQuery.error ?? (!historyData ? historyQuery.error : null)
  if (error) {
    return (
      <ErrorState
        title="Could not open conversation"
        description={errorMessage(error)}
        isActionPending={sessionQuery.isFetching || historyQuery.isFetching}
        onAction={() => {
          void sessionQuery.refetch()
          void historyQuery.refetch()
        }}
      />
    )
  }
  if (sessionQuery.isPending || (!historyData && historyQuery.isPending) || composerDraft.isPending) {
    return <LoadingState />
  }
  if (!sessionQuery.data) {
    return (
      <ErrorState
        title="Conversation not found"
        isActionPending={sessionQuery.isFetching}
        onAction={() => { void sessionQuery.refetch() }}
      />
    )
  }
  const activeRun = runtimeStatusQuery.data?.activeRun ?? undefined
  const hasEarlier = Boolean(historyQuery.hasNextPage ?? historyData?.pages.at(-1)?.nextCursor)
  const isStreaming = runtimeIsActive
  const queuedCount = runtimeStatusQuery.data?.queue.pending ?? 0
  return (
    <>
      <Stack.Screen options={{ title: sessionQuery.data.title ?? 'Conversation' }} />
      {Platform.OS === 'ios' && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            accessibilityHint={sessionQuery.data.pinned > 0
              ? 'Removes this conversation from your pinned conversations'
              : 'Keeps this conversation easy to find in its workspace'}
            accessibilityLabel={sessionQuery.data.pinned > 0
              ? 'Unpin conversation'
              : 'Pin conversation'}
            disabled={updatePin.isPending}
            onPress={() => updatePin.mutate(sessionQuery.data.pinned === 0)}
            selected={sessionQuery.data.pinned > 0}
          >
            <Stack.Toolbar.Icon sf={sessionQuery.data.pinned > 0 ? 'pin.fill' : 'pin'} />
            <Stack.Toolbar.Label>
              {sessionQuery.data.pinned > 0 ? 'Unpin' : 'Pin'}
            </Stack.Toolbar.Label>
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <ChatView
        activeRun={activeRun}
        clearComposerDraftSignal={composerDraft.clearSignal}
        composerDraft={composerDraft.initialDraft}
        composerDraftKey={`chat:${sessionId}`}
        isCancelling={cancel.isPending}
        capabilities={capabilitiesQuery.data}
        isSending={send.isPending || queue.isPending || steer.isPending}
        isStreaming={isStreaming}
        liveMessage={liveMessage}
        messages={messages}
        onCancel={handleCancel}
        onComposerDraftChange={composerDraft.scheduleSave}
        onCopyMessage={async (text) => {
          await Clipboard.setStringAsync(text)
        }}
        onModeChange={handleModeChange}
        onSend={handleSend}
        pendingUser={pendingUser}
        queuedCount={queuedCount}
        sendError={sendError}
        runtimeSettings={runtimeSettingsQuery.data}
        hasEarlier={hasEarlier}
        isLoadingEarlier={historyQuery.isFetchingNextPage}
        detailMessage={detailQuery.data?.message as UIMessage | undefined}
        detailMessageId={detailMessageId}
        isLoadingMessageDetail={detailQuery.isFetching}
        messageDetailError={detailQuery.error ? errorMessage(detailQuery.error) : null}
        onLoadEarlier={() => {
          if (hasEarlier && !historyQuery.isFetchingNextPage) {
            void historyQuery.fetchNextPage()
          }
        }}
        onRequestMessageDetail={setDetailMessageId}
        onShareMessage={async (text) => {
          await Share.share({ message: text })
        }}
      />
    </>
  )
}
