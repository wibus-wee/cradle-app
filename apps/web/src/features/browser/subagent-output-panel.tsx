import {
  CheckCircleLine as CheckCircle2Icon,
  CloseCircleLine as XCircleIcon,
  RobotLine as BotIcon,
} from '@mingcute/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'

import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import { chatSelectors } from '~/store/chat'
import { useRendererChatStore } from '~/store/renderer-chat'

import { submitRuntimeToolApproval } from '../chat/commands/chat-response-command'
import { getProviderThread, getProviderThreadTurns, providerThreadQueryKey, providerThreadTurnsQueryKey, subscribeProviderThreadStream } from '../chat/commands/provider-thread-command'
import { ChatRenderStoreProvider, MessageBubble } from '../chat/rendering/message-bubble'
import { SubagentIdenticon } from '../chat/rendering/subagent-identicon'
import { isMatchingApprovalPart, readRuntimeUserInputRequestId } from '../chat/session/use-chat-session-types'
import { ChatStreamingHandler } from '../chat/transport/chat-streaming-handler'
import { buildUIMessageChunkStreamFromResponse } from '../chat/transport/sse-chat-transport'

const rendererChatStore = useRendererChatStore

interface SubagentOutputPanelProps {
  sessionId: string
  threadId: string
  agentName: string
  agentRole: string | null
}

export function SubagentOutputPanel({
  sessionId,
  threadId,
  agentName,
  agentRole,
}: SubagentOutputPanelProps) {
  const { t } = useTranslation('chat')
  const outputScrollRef = useRef<HTMLDivElement | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const scrollMeasureFrameRef = useRef<number | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const viewSessionId = buildProviderThreadViewSessionId(sessionId, threadId)
  const queryClient = useQueryClient()

  const {
    data: threadData,
    isError: isThreadError,
    isLoading: isThreadLoading,
  } = useQuery({
    queryKey: providerThreadQueryKey(sessionId, threadId),
    queryFn: ({ signal }) => getProviderThread(sessionId, threadId, signal),
    enabled: !!sessionId && !!threadId,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const thread = threadData?.thread ?? null

  const {
    data: turnsData,
    isError: isTurnsError,
    isLoading: isTurnsLoading,
  } = useQuery({
    queryKey: providerThreadTurnsQueryKey(sessionId, threadId),
    queryFn: ({ signal }) => getProviderThreadTurns(sessionId, threadId, signal),
    enabled: !!sessionId && !!threadId,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    const messages = turnsData?.messages
    if (!messages) {
      return
    }
    const store = useRendererChatStore.getState()
    const hydratedIds = new Set(messages.map(message => message.id))
    const hasHydratedMessages = messages.length > 0
    const liveMessages = (store.messagesMap.get(viewSessionId) ?? [])
      .filter((message) => {
        if (hydratedIds.has(message.id) || isProviderThreadLiveFallbackMessageId(message.id, sessionId, threadId)) {
          return false
        }
        return !hasHydratedMessages || chatSelectors.isStreamingMessage(message.id)(store)
      })
    store.setMessages(viewSessionId, [...messages, ...liveMessages])
  }, [sessionId, threadId, turnsData?.messages, viewSessionId])

  useEffect(() => {
    if (!sessionId || !threadId || isThreadLoading || isThreadError || thread?.status === 'completed') {
      return
    }
    const controller = new AbortController()
    const placeholderMessageId = providerThreadLiveFallbackMessageId(threadId)
    const handler = new ChatStreamingHandler(
      viewSessionId,
      placeholderMessageId,
      performance.now(),
      {
        mode: 'passive',
        useStoredMessageSnapshot: false,
        store: useRendererChatStore,
        emitSettledEvents: false,
      },
    )
    handler.start(controller)

    void (async () => {
      try {
        const response = await subscribeProviderThreadStream({
          sessionId,
          threadId,
          signal: controller.signal,
        })
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          handler.fail(`Failed to subscribe provider thread stream: ${response.status} ${body}`)
          return
        }
        const stream = buildUIMessageChunkStreamFromResponse(response, viewSessionId)
        await handler.consume(stream)
        handler.finish()
        void queryClient.invalidateQueries({ queryKey: providerThreadQueryKey(sessionId, threadId) })
        void queryClient.invalidateQueries({ queryKey: providerThreadTurnsQueryKey(sessionId, threadId) })
      }
      catch (error) {
        if (controller.signal.aborted) {
          return
        }
        handler.fail(error instanceof Error ? error.message : String(error))
      }
    })()

    return () => {
      controller.abort()
      handler.dispose()
    }
  }, [isThreadError, isThreadLoading, queryClient, sessionId, thread?.status, threadId, viewSessionId])

  const messages = useRendererChatStore(useShallow(chatSelectors.messages(viewSessionId)))
  const streamStatus = useRendererChatStore(chatSelectors.visibleStatus(viewSessionId))
  const fallbackDisplayName = agentName.trim() || thread?.name || 'Subagent'
  const displayName = thread?.agentNickname ?? fallbackDisplayName
  const displayRole = thread?.agentRole ?? agentRole
  const liveStreamPending = streamStatus === 'streaming' && messages.length === 0
  const status = thread?.status ?? (isTurnsLoading || liveStreamPending ? 'active' : 'idle')
  const statusLabel = formatAgentStatus(status)
  const hasError
    = (isThreadError || isTurnsError || streamStatus === 'error')
      && messages.length === 0
      && !liveStreamPending

  const handleToolApprovalResponse = useCallback(async (response: {
    messageId: string
    approvalId: string
    approved: boolean
  }) => {
    const requestId = readRuntimeUserInputRequestId(response.approvalId)
    useRendererChatStore.getState().updateMessage(viewSessionId, response.messageId, message => ({
      ...message,
      parts: message.parts.map(part =>
        isMatchingApprovalPart(part, response.approvalId)
          ? {
              ...part,
              state: 'approval-responded',
              approval: {
                id: response.approvalId,
                approved: response.approved,
              },
            } as UIMessage['parts'][number]
          : part),
    }), { dirtyToolCallIds: new Set([response.approvalId]) })
    await submitRuntimeToolApproval({
      sessionId,
      requestId,
      approved: response.approved,
    })
  }, [sessionId, viewSessionId])

  const cancelScheduledScroll = useCallback(() => {
    if (scrollFrameRef.current === null) {
      return
    }
    window.cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = null
  }, [])

  const cancelScheduledScrollMeasure = useCallback(() => {
    if (scrollMeasureFrameRef.current === null) {
      return
    }
    window.cancelAnimationFrame(scrollMeasureFrameRef.current)
    scrollMeasureFrameRef.current = null
  }, [])

  const scheduleScrollOutputToBottom = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      return
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      const viewport = outputScrollRef.current
      if (!viewport) {
        return
      }
      viewport.scrollTop = Number.MAX_SAFE_INTEGER
    })
  }, [])

  const handleOutputScroll = useCallback(() => {
    if (scrollMeasureFrameRef.current !== null) {
      return
    }
    scrollMeasureFrameRef.current = window.requestAnimationFrame(() => {
      scrollMeasureFrameRef.current = null
      const viewport = outputScrollRef.current
      if (!viewport) {
        return
      }
      const scrollBottom = viewport.scrollTop + viewport.clientHeight
      shouldStickToBottomRef.current = scrollBottom >= viewport.scrollHeight - 48
    })
  }, [])

  useEffect(() => {
    shouldStickToBottomRef.current = true
    scheduleScrollOutputToBottom()
    return cancelScheduledScroll
  }, [cancelScheduledScroll, scheduleScrollOutputToBottom, viewSessionId])

  useEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return
    }
    scheduleScrollOutputToBottom()
  }, [hasError, messages.length, scheduleScrollOutputToBottom])

  useEffect(() => {
    const viewport = outputScrollRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') {
      return
    }

    let observedContent: Element | null = null
    const observer = new ResizeObserver(() => {
      if (shouldStickToBottomRef.current) {
        scheduleScrollOutputToBottom()
      }
    })

    const observeCurrentContent = () => {
      const content = viewport.firstElementChild
      if (content === observedContent) {
        return
      }
      if (observedContent) {
        observer.unobserve(observedContent)
      }
      observedContent = content
      if (observedContent) {
        observer.observe(observedContent)
      }
    }

    const mutationObserver = new MutationObserver(() => {
      observeCurrentContent()
      if (shouldStickToBottomRef.current) {
        scheduleScrollOutputToBottom()
      }
    })

    observer.observe(viewport)
    observeCurrentContent()
    mutationObserver.observe(viewport, { childList: true })

    return () => {
      observer.disconnect()
      mutationObserver.disconnect()
      cancelScheduledScroll()
      cancelScheduledScrollMeasure()
    }
  }, [cancelScheduledScroll, cancelScheduledScrollMeasure, scheduleScrollOutputToBottom, viewSessionId])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-testid="subagent-output-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-card px-3 py-2">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background">
          <SubagentIdenticon
            active={false}
            seed={threadId}
            className="size-5"
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{displayName}</p>
          {displayRole && (
            <p className="truncate text-[10px] text-muted-foreground">{displayRole}</p>
          )}
        </div>
        <AgentStatusBadge status={hasError ? 'errored' : status} label={hasError ? 'Error' : statusLabel} />
      </div>

      <div ref={outputScrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" onScroll={handleOutputScroll}>
        {hasError
          ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground/60">
            <XCircleIcon className="size-8 !text-destructive/70" />
            <p className="text-[11px]">Unable to load subagent thread</p>
          </div>
        )
          : messages.length > 0
            ? (
          <div className="space-y-3">
            {messages.map(message => (
              <ProviderThreadMessage
                key={message.id}
                sessionId={sessionId}
                viewSessionId={viewSessionId}
                messageId={message.id}
                onToolApprovalResponse={handleToolApprovalResponse}
              />
            ))}
          </div>
        )
            : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground/60">
            <BotIcon className="size-8 opacity-40" />
            <p className="text-[11px]">
              {isTurnsLoading || liveStreamPending ? 'Loading output...' : 'No output yet'}
            </p>
          </div>
        )}
      </div>

      <div className="shrink-0 bg-background px-3 py-2 text-center text-[11px] text-muted-foreground">
        {t('subagent.output.readOnly')}
      </div>
    </div>
  )
}

function ProviderThreadMessage({
  sessionId,
  viewSessionId,
  messageId,
  onToolApprovalResponse,
}: {
  sessionId: string
  viewSessionId: string
  messageId: string
  onToolApprovalResponse?: (response: {
    messageId: string
    approvalId: string
    approved: boolean
  }) => void
}) {
  const message = useRendererChatStore(chatSelectors.message(viewSessionId, messageId))
  const isStreaming = useRendererChatStore(chatSelectors.isVisibleStreamingMessage(viewSessionId, messageId))
  if (!message) {
    return null
  }
  return (
    <ChatRenderStoreProvider store={rendererChatStore}>
      <MessageBubble
        message={message}
        isStreaming={isStreaming}
        executionDetailsDefaultOpen={false}
        sessionId={sessionId}
        onToolApprovalResponse={onToolApprovalResponse}
      />
    </ChatRenderStoreProvider>
  )
}

function AgentStatusBadge({
  status,
  label,
}: {
  status: string
  label: string
}) {
  const tone = getAgentStatusTone(status)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'active' && 'bg-primary/10 text-primary',
        tone === 'success' && 'bg-green-500/10 text-green-600 dark:text-green-400',
        tone === 'error' && 'bg-destructive/10 text-destructive',
        tone === 'idle' && 'bg-muted text-muted-foreground',
      )}
    >
      {tone === 'active' && <Spinner className="size-2.5" />}
      {tone === 'success' && <CheckCircle2Icon className="size-2.5" />}
      {tone === 'error' && <XCircleIcon className="size-2.5" />}
      {label}
    </span>
  )
}

function buildProviderThreadViewSessionId(sessionId: string, threadId: string): string {
  return `provider-thread:${sessionId}:${threadId}`
}

function providerThreadLiveFallbackMessageId(threadId: string): string {
  return `provider-thread:${threadId}:live`
}

function isProviderThreadLiveFallbackMessageId(messageId: string, sessionId: string, threadId: string): boolean {
  return messageId === providerThreadLiveFallbackMessageId(threadId)
    || messageId === `provider-thread:${sessionId}:${threadId}:live`
}

function formatAgentStatus(status: string): string {
  const labels: Record<string, string> = {
    active: 'Running',
    idle: 'Idle',
    notLoaded: 'Pending',
    systemError: 'Error',
    pendingInit: 'Pending',
    running: 'Running',
    interrupted: 'Interrupted',
    completed: 'Completed',
    errored: 'Error',
    shutdown: 'Shutdown',
    notFound: 'Not Found',
  }
  return labels[status] ?? status
}

function getAgentStatusTone(status: string): 'active' | 'success' | 'error' | 'idle' {
  if (status === 'active' || status === 'running') { return 'active' }
  if (status === 'completed') { return 'success' }
  if (status === 'errored' || status === 'interrupted' || status === 'systemError') { return 'error' }
  return 'idle'
}
